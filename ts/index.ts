import Debug from "debug";
import defer, { DeferredPromise } from "p-defer";
const debug = Debug("promise-batcher");

function isNull(val: any): val is null | undefined {
    return val === undefined || val === null;
}

export class BatcherToken {}

/**
 * If this token is returned in the results from a batchingFunction, the corresponding requests will be placed back
 * into the the head of the queue.
 */
export const BATCHER_RETRY_TOKEN: BatcherToken = new BatcherToken();

export type BatchingResult<T> = T | Error | BatcherToken;

export interface BatcherOptions<I, O> {
    /**
     * The maximum number of requests that can be combined in a single batch.
     */
    maxBatchSize?: number;
    /**
     * The number of milliseconds to wait before running a batch of requests.
     *
     * This is used to allow time for the requests to queue up. Defaults to 1ms.
     * This delay does not apply if the limit set by options.maxBatchSize is reached.
     */
    queuingDelay?: number;
    /**
     * An array containing the number of requests that must be queued in order to trigger a batch request at each level
     * of concurrency.
     *
     * For example [1, 5], would require at least 1 queued request when no batch requests are active,
     * and 5 queued requests when 1 (or more) batch requests are active. Defaults to [1]. Note that the delay imposed
     * by options.queuingDelay still applies when a batch request is triggered.
     */
    queuingThresholds?: number[];
    /**
     * A function which is passed an array of request values, returning a promise which resolves to an array of
     * response values.
     *
     * The request and response arrays must be of equal length. To reject an individual request, return an Error object
     * (or class which extends Error) at the corresponding element in the response array.
     */
    batchingFunction(inputs: I[]): Array<BatchingResult<O>> | PromiseLike<Array<BatchingResult<O>>>;
    /**
     * A function which can delay a batch by returning a promise which resolves when the batch should be run.
     * If the function does not return a promise, no delay will be applied.
     */
    delayFunction?(): PromiseLike<void> | undefined | null | void;
}

// tslint:disable-next-line:max-classes-per-file
export class Batcher<I, O> {
    private _maxBatchSize: number = Infinity;
    private _queuingDelay: number = 1;
    private _queuingThresholds: number[];
    private _inputQueue: I[] = [];
    private _outputQueue: Array<DeferredPromise<O>> = [];
    private _delayFunction?: () => PromiseLike<void> | undefined | null | void;
    private _batchingFunction: (input: I[]) => Array<BatchingResult<O>> | PromiseLike<Array<BatchingResult<O>>>;
    private _waitTimeout?: any;
    private _waiting: boolean = false;
    private _activePromiseCount: number = 0;
    private _immediateCount: number = 0;

    constructor(options: BatcherOptions<I, O>) {
        this._batchingFunction = options.batchingFunction;
        this._delayFunction = options.delayFunction;
        if (Array.isArray(options.queuingThresholds)) {
            if (!options.queuingThresholds.length) {
                throw new Error("options.batchThresholds must contain at least one number");
            }
            options.queuingThresholds.forEach((n) => {
                if (n < 1) {
                    throw new Error("options.batchThresholds must only contain numbers greater than 0");
                }
            });
            this._queuingThresholds = options.queuingThresholds.slice();
        } else {
            this._queuingThresholds = [1];
        }
        if (!isNull(options.maxBatchSize)) {
            if (options.maxBatchSize < 1) {
                throw new Error("options.batchSize must be greater than 0");
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
    public getResult(input: I): Promise<O> {
        const index = this._inputQueue.length;
        debug("Queuing request at index %O", index);
        this._inputQueue[index] = input;
        const deferred = defer<O>();
        this._outputQueue[index] = deferred;
        this._trigger();
        return deferred.promise;
    }

    /**
     * Triggers a batch to run, bypassing the queuingDelay while respecting other imposed delays.
     */
    public send(): void {
        debug("Send triggered.");
        // no inputs?
        // delayed?
        this._immediateCount = this._inputQueue.length;
        this._trigger();
    }

    /**
     * Triggers a batch to run, adhering to the maxBatchSize, queueingThresholds, and queuingDelay
     */
    private _trigger(): void {
        // If the batch is set to run immediately, there is nothing more to be done
        if (this._waiting && !this._waitTimeout) {
            return;
        }
        // Always obey the queuing threshold
        const thresholdIndex: number = Math.min(this._activePromiseCount, this._queuingThresholds.length - 1);
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
    private _run(): void {
        if (this._delayFunction) {
            let result: void | PromiseLike<void> | null | undefined;
            try {
                result = this._delayFunction();
            } catch (err) {
                result = Promise.reject(err);
            }
            if (!isNull(result)) {
                const resultPromise = result instanceof Promise ? result : Promise.resolve(result);
                resultPromise
                    .then(() => {
                        this._runImmediately();
                    })
                    .catch((err) => {
                        debug("Caught error in delayFunction. Rejecting promises.");
                        this._inputQueue.length = 0;
                        const promises = this._outputQueue.splice(0, this._outputQueue.length);
                        promises.forEach((promise) => {
                            promise.reject(err);
                        });
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
    private _runImmediately(): void {
        const inputs = this._inputQueue.splice(0, this._maxBatchSize);
        const outputPromises = this._outputQueue.splice(0, this._maxBatchSize);
        if (this._immediateCount) {
            this._immediateCount = Math.max(0, this._immediateCount - inputs.length);
        }

        debug("Running batch of %O", inputs.length);
        let batchPromise: Promise<Array<BatchingResult<O>>>;
        try {
            const batch = this._batchingFunction.call(this, inputs);
            batchPromise = batch instanceof Promise ? batch : Promise.resolve(batch);
        } catch (err) {
            batchPromise = Promise.reject(err);
        }

        this._waiting = false;
        this._activePromiseCount++;
        batchPromise
            .then((outputs) => {
                if (!Array.isArray(outputs)) {
                    throw new Error("Invalid type returned from batching function.");
                }
                debug("Promise resolved.");
                if (outputs.length !== outputPromises.length) {
                    throw new Error("Batching function output length does not equal the input length.");
                }
                const retryInputs: I[] = [];
                const retryPromises: Array<DeferredPromise<O>> = [];
                outputPromises.forEach((promise, index) => {
                    const output = outputs[index];
                    if (output === BATCHER_RETRY_TOKEN) {
                        retryInputs.push(inputs[index]);
                        retryPromises.push(promise);
                    } else if (output instanceof Error) {
                        promise.reject(output);
                    } else {
                        promise.resolve(output as O);
                    }
                });
                if (retryPromises.length) {
                    debug("Adding %O requests to the queue to retry.", retryPromises.length);
                    if (this._immediateCount) {
                        this._immediateCount += retryPromises.length;
                    }
                    this._inputQueue.unshift(...retryInputs);
                    this._outputQueue.unshift(...retryPromises);
                }
            })
            .catch((err) => {
                outputPromises.forEach((promise) => {
                    promise.reject(err);
                });
            })
            .then(() => {
                this._activePromiseCount--;
                // Since we may be operating at a lower queuing threshold now, we should try run again
                this._trigger();
            });
        // The batch has started. Trigger another batch if appropriate.
        this._trigger();
    }
}
