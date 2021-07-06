"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Batcher = exports.BATCHER_RETRY_TOKEN = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
const util_1 = __importDefault(require("util"));
const debug = util_1.default.debuglog("promise-batcher");
function isNull(val) {
    return val === undefined || val === null;
}
/**
 * If this token is returned in the results from a batchingFunction, the corresponding requests will be placed back
 * into the the head of the queue.
 */
exports.BATCHER_RETRY_TOKEN = Symbol("PromiseBatcher.BATCHER_RETRY_TOKEN");
// tslint:disable-next-line:max-classes-per-file
class Batcher {
    constructor(options) {
        this._maxBatchSize = Infinity;
        this._queuingDelay = 1;
        this._inputQueue = [];
        this._outputQueue = [];
        this._waiting = false;
        this._activePromiseCount = 0;
        this._immediateCount = 0;
        this._batchingFunction = options.batchingFunction;
        this._delayFunction = options.delayFunction;
        if (Array.isArray(options.queuingThresholds)) {
            if (!options.queuingThresholds.length) {
                throw new Error("options.queuingThresholds must contain at least one number");
            }
            for (const n of options.queuingThresholds) {
                if (n < 1) {
                    throw new Error("options.queuingThresholds must only contain numbers greater than 0");
                }
            }
            this._queuingThresholds = options.queuingThresholds.slice();
        }
        else {
            this._queuingThresholds = [1];
        }
        if (!isNull(options.maxBatchSize)) {
            if (options.maxBatchSize < 1) {
                throw new Error("options.maxBatchSize must be greater than 0");
            }
            this._maxBatchSize = options.maxBatchSize;
        }
        if (!isNull(options.queuingDelay)) {
            if (options.queuingDelay < 0) {
                throw new Error("options.queuingDelay must be greater than or equal to 0");
            }
            this._queuingDelay = options.queuingDelay;
        }
    }
    /**
     * Returns a promise which resolves or rejects with the individual result returned from the batching function.
     */
    getResult(input) {
        const index = this._inputQueue.length;
        debug("Queuing request at index %O", index);
        this._inputQueue[index] = input;
        const deferred = p_defer_1.default();
        this._outputQueue[index] = deferred;
        this._trigger();
        return deferred.promise;
    }
    /**
     * Triggers a batch to run, bypassing the queuingDelay while respecting other imposed delays.
     */
    send() {
        debug("Send triggered.");
        // no inputs?
        // delayed?
        this._immediateCount = this._inputQueue.length;
        this._trigger();
    }
    /**
     * Triggers a batch to run, adhering to the maxBatchSize, queueingThresholds, and queuingDelay
     */
    _trigger() {
        // If the batch is set to run immediately, there is nothing more to be done
        if (this._waiting && !this._waitTimeout) {
            return;
        }
        // Always obey the queuing threshold
        const thresholdIndex = Math.min(this._activePromiseCount, this._queuingThresholds.length - 1);
        if (this._inputQueue.length < this._queuingThresholds[thresholdIndex]) {
            return;
        }
        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize || this._immediateCount) {
            debug("Running immediately.");
            if (this._waitTimeout) {
                clearTimeout(this._waitTimeout);
                this._waitTimeout = undefined;
            }
            this._waiting = true;
            this._run();
            return;
        }
        if (this._waiting) {
            return;
        }
        // Run the batch, but with a delay
        this._waiting = true;
        debug("Running in %Oms (thresholdIndex %O).", this._queuingDelay, thresholdIndex);
        // Tests showed that nextTick would commonly run before promises could resolve.
        // SetImmediate would run later than setTimeout as well.
        this._waitTimeout = setTimeout(() => {
            this._waitTimeout = undefined;
            this._run();
        }, this._queuingDelay);
    }
    /**
     * Runs the batch, while respecting delays imposed by the supplied delayFunction
     */
    _run() {
        if (this._delayFunction) {
            let result;
            try {
                result = this._delayFunction();
            }
            catch (err) {
                result = Promise.reject(err);
            }
            if (result) {
                const resultPromise = result instanceof Promise ? result : Promise.resolve(result);
                resultPromise
                    .then(() => {
                    this._runImmediately();
                })
                    .catch((err) => {
                    debug("Caught error in delayFunction. Rejecting promises.");
                    this._inputQueue.length = 0;
                    const promises = this._outputQueue.splice(0, this._outputQueue.length);
                    for (const promise of promises) {
                        promise.reject(err);
                    }
                    this._waiting = false;
                });
                return;
            }
            debug("Bypassing batch delay.");
        }
        this._runImmediately();
    }
    /**
     * Runs the batch immediately without further delay
     */
    _runImmediately() {
        const inputs = this._inputQueue.splice(0, this._maxBatchSize);
        const outputPromises = this._outputQueue.splice(0, this._maxBatchSize);
        if (this._immediateCount) {
            this._immediateCount = Math.max(0, this._immediateCount - inputs.length);
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
            try {
                debug("Running batch of %O", inputs.length);
                this._waiting = false;
                this._activePromiseCount++;
                let batchPromise;
                try {
                    batchPromise = this._batchingFunction.call(this, inputs);
                }
                finally {
                    // The batch has started. Trigger another batch if appropriate.
                    this._trigger();
                }
                const outputs = await batchPromise;
                if (!Array.isArray(outputs)) {
                    throw new Error("batchingFunction must return an array");
                }
                debug("Promise resolved.");
                if (outputs.length !== outputPromises.length) {
                    throw new Error("batchingFunction output length does not equal the input length");
                }
                const retryInputs = [];
                const retryPromises = [];
                for (const [index, promise] of outputPromises.entries()) {
                    const output = outputs[index];
                    if (output === exports.BATCHER_RETRY_TOKEN) {
                        retryInputs.push(inputs[index]);
                        retryPromises.push(promise);
                    }
                    else if (output instanceof Error) {
                        promise.reject(output);
                    }
                    else {
                        promise.resolve(output);
                    }
                }
                if (retryPromises.length) {
                    debug("Adding %O requests to the queue to retry.", retryPromises.length);
                    if (this._immediateCount) {
                        this._immediateCount += retryPromises.length;
                    }
                    this._inputQueue.unshift(...retryInputs);
                    this._outputQueue.unshift(...retryPromises);
                }
            }
            catch (err) {
                for (const promise of outputPromises) {
                    promise.reject(err);
                }
            }
            finally {
                this._activePromiseCount--;
                // Since we may be operating at a lower queuing threshold now, we should try run again
                this._trigger();
            }
        })();
    }
}
exports.Batcher = Batcher;
