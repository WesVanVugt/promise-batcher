/**
 * If this token is returned in the results from a batchingFunction, the corresponding requests will be placed back
 * into the the head of the queue.
 */
export declare const BATCHER_RETRY_TOKEN: unique symbol;
export type BatchingResult<T> = T | Error | typeof BATCHER_RETRY_TOKEN;
export interface BatcherOptions<I, O> {
	/**
	 * The maximum number of requests that can be combined in a single batch.
	 */
	readonly maxBatchSize?: number;
	/**
	 * The number of milliseconds to wait before running a batch of requests.
	 *
	 * This is used to allow time for the requests to queue up. Defaults to 1ms.
	 * This delay does not apply if the limit set by options.maxBatchSize is reached.
	 */
	readonly queuingDelay?: number;
	/**
	 * An array containing the number of requests that must be queued in order to trigger a batch request at each level
	 * of concurrency.
	 *
	 * For example [1, 5], would require at least 1 queued request when no batch requests are active,
	 * and 5 queued requests when 1 (or more) batch requests are active. Defaults to [1]. Note that the delay imposed
	 * by options.queuingDelay still applies when a batch request is triggered.
	 */
	readonly queuingThresholds?: readonly number[];
	/**
	 * A function which is passed an array of request values, returning a promise which resolves to an array of
	 * response values.
	 *
	 * The request and response arrays must be of equal length. To reject an individual request, return an Error object
	 * (or class which extends Error) at the corresponding element in the response array.
	 */
	readonly batchingFunction: (
		this: Batcher<I, O>,
		inputs: readonly I[],
	) => ReadonlyArray<BatchingResult<O>> | PromiseLike<ReadonlyArray<BatchingResult<O>>>;
	/**
	 * A function which can delay a batch by returning a promise which resolves when the batch should be run.
	 * If the function does not return a promise, no delay will be applied.
	 */
	readonly delayFunction?: () => PromiseLike<void> | undefined | null | void;
}
export declare class Batcher<I, O> {
	private readonly _maxBatchSize;
	private readonly _queuingDelay;
	private readonly _queuingThresholds;
	private readonly _inputQueue;
	private readonly _outputQueue;
	private readonly _delayFunction?;
	private readonly _batchingFunction;
	private _waitTimeout?;
	private _idlePromise?;
	private _waiting;
	private _activeBatchCount;
	private _immediateCount;
	constructor(options: BatcherOptions<I, O>);
	/**
	 * Returns a promise which resolves or rejects with the individual result returned from the batching function.
	 */
	getResult(input: I): Promise<O>;
	/**
	 * Triggers a batch to run, bypassing the queuingDelay while respecting other imposed delays.
	 */
	send(): void;
	/**
	 * Triggers a batch to run, adhering to the maxBatchSize, queueingThresholds, and queuingDelay
	 */
	private _trigger;
	/**
	 * Runs the batch, while respecting delays imposed by the supplied delayFunction
	 */
	private _run;
	/**
	 * Runs the batch immediately without further delay
	 */
	private _runImmediately;
	/**
	 * `true` when there are no pending batches, and `false` otherwise.
	 */
	get idling(): boolean;
	/**
	 * Returns a promise which resolves there are no pending batches.
	 */
	idlePromise(): Promise<void>;
}
