"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Batcher = exports.BATCHER_RETRY_TOKEN = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
const util_1 = __importDefault(require("util"));
const debug = util_1.default.debuglog("promise-batcher");
function isNull(val) {
	return val === undefined || val === null;
}
exports.BATCHER_RETRY_TOKEN = Symbol("PromiseBatcher.BATCHER_RETRY_TOKEN");
class Batcher {
	constructor(options) {
		this._maxBatchSize = Infinity;
		this._queuingDelay = 1;
		this._inputQueue = [];
		this._outputQueue = [];
		this._waiting = false;
		this._activeBatchCount = 0;
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
		} else {
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
	getResult(input) {
		const index = this._inputQueue.length;
		debug("Queuing request at index %O", index);
		this._inputQueue[index] = input;
		const deferred = (0, p_defer_1.default)();
		this._outputQueue[index] = deferred;
		this._trigger();
		return deferred.promise;
	}
	send() {
		debug("Send triggered.");
		this._immediateCount = this._inputQueue.length;
		this._trigger();
	}
	_trigger() {
		if (this._waiting && !this._waitTimeout) {
			return;
		}
		const thresholdIndex = Math.min(this._activeBatchCount, this._queuingThresholds.length - 1);
		if (this._inputQueue.length < this._queuingThresholds[thresholdIndex]) {
			if (this._idlePromise && this.idling) {
				this._idlePromise.resolve();
				this._idlePromise = undefined;
			}
			return;
		}
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
		this._waiting = true;
		debug("Running in %Oms (thresholdIndex %O).", this._queuingDelay, thresholdIndex);
		this._waitTimeout = setTimeout(() => {
			this._waitTimeout = undefined;
			this._run();
		}, this._queuingDelay);
	}
	_run() {
		if (this._delayFunction) {
			let result;
			try {
				result = this._delayFunction();
			} catch (err) {
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
	_runImmediately() {
		const inputs = this._inputQueue.splice(0, this._maxBatchSize);
		const outputPromises = this._outputQueue.splice(0, this._maxBatchSize);
		if (this._immediateCount) {
			this._immediateCount = Math.max(0, this._immediateCount - inputs.length);
		}
		(async () => {
			try {
				debug("Running batch of %O", inputs.length);
				this._waiting = false;
				this._activeBatchCount++;
				let batchPromise;
				try {
					batchPromise = this._batchingFunction.call(this, inputs);
				} finally {
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
					} else if (output instanceof Error) {
						promise.reject(output);
					} else {
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
			} catch (err) {
				for (const promise of outputPromises) {
					promise.reject(err);
				}
			} finally {
				this._activeBatchCount--;
				this._trigger();
			}
		})();
	}
	get idling() {
		return this._activeBatchCount <= 0 && this._inputQueue.length <= 0;
	}
	async idlePromise() {
		if (this.idling) {
			return;
		}
		if (!this._idlePromise) {
			this._idlePromise = (0, p_defer_1.default)();
		}
		return this._idlePromise.promise;
	}
}
exports.Batcher = Batcher;
