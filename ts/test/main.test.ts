import FakeTimers from "@sinonjs/fake-timers";
import chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import Debug from "debug";
import PromiseLikeClass from "promise-polyfill";
import timeSpan from "time-span";
import { expectType, TypeEqual } from "ts-expect";
import { promisify } from "util";
import { Batcher, BATCHER_RETRY_TOKEN, BatcherOptions, BatchingResult } from "./imports";
const clock = FakeTimers.install();
const debug = Debug("promise-batcher:test");
chai.use(chaiAsPromised);

// Make the promise like the PromiseLike interface
// @ts-expect-error
delete PromiseLikeClass.prototype.catch;
// @ts-expect-error
delete PromiseLikeClass.prototype.finally;

/**
 * Milliseconds per tick.
 */
const TICK = 100;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
const wait = promisify(setTimeout);

/**
 * Maximum number of timers to advance before giving up. This is used to prevent infinite loops.
 */
const MAX_TIMER_ADVANCE = 100;

/**
 * Uses SinonJS Fake Timers to wait for a promise to complete.
 */
async function fakeAwait<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    try {
        const v = await Promise.race([
            promise,
            (async () => {
                for (let timerCount = 0; timerCount < MAX_TIMER_ADVANCE; timerCount++) {
                    if (done) {
                        // exit the timer loop; this error should never be caught
                        throw new Error("fakeAwait: done");
                    }
                    if ((await clock.nextAsync()) === 0) {
                        throw new Error("fakeAwait: no timers to advance");
                    }
                }
                throw new Error("fakeAwait: too many timers");
            })(),
        ]);
        done = true;
        return v;
    } catch (err) {
        done = true;
        throw err;
    }
}

// istanbul ignore next
function unhandledRejectionListener(err: unknown) {
    debug("unhandledRejectionListener: " + (err as Error).stack);
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + (err as Error).message);
}

beforeEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
});

describe("Batcher", () => {
    it("Core Functionality", async () => {
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: async (input) => {
                runCount++;
                await wait(TICK);
                return input.map(String);
            },
        });
        const inputs = [1, 5, 9];
        const elapsed = timeSpan();
        await fakeAwait(
            Promise.all(
                inputs.map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(String(input), "Outputs");
                    expect(elapsed()).to.equal(TICK + 1, "Timing Results");
                }),
            ),
        );
        expect(runCount).to.equal(1, "runCount");
    });
    it("Offset Batches", async () => {
        // Runs two batches of requests, offset so the seconds starts while the first is half finished.
        // The second batch should start before the first finishes.
        const elapsed = timeSpan();
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: async (input) => {
                runCount++;
                await wait(2 * TICK);
                return input.map(String);
            },
        });
        const inputs = [
            [1, 9],
            [5, 7],
        ];
        await fakeAwait(
            Promise.all(
                inputs.map(async (input, index) => {
                    await wait(index * TICK);
                    await Promise.all(
                        input.map(async (value, index2) => {
                            const result = await batcher.getResult(value);
                            expect(result).to.equal(String(value));
                            expect(elapsed()).to.equal((index + 2) * TICK + 1, `Timing result (${index},${index2})`);
                        }),
                    );
                }),
            ),
        );
        expect(runCount).to.equal(2, "runCount");
    });
    it("Delay Function", async () => {
        let runCount: number = 0;
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: async (input) => {
                runCount++;
                await wait(1);
                return input;
            },
            delayFunction: () => wait(TICK),
            maxBatchSize: 2,
        });
        const inputs = [1, 5, 9];
        const elapsed = timeSpan();
        const times = await fakeAwait(
            Promise.all(
                inputs.map(async () => {
                    await batcher.getResult(undefined);
                    return elapsed();
                }),
            ),
        );
        expect(times).to.deep.equal([TICK + 1, TICK + 1, 2 * TICK + 2], "Timing Results");
        expect(runCount).to.equal(2, "runCount");
    });
    it("Delay Function (PromiseLike)", async () => {
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: (input) => {
                return PromiseLikeClass.resolve(wait(TICK)).then(() => input);
            },
            delayFunction: () => PromiseLikeClass.resolve(wait(TICK)),
            maxBatchSize: 2,
        });
        const elapsed = timeSpan();
        await fakeAwait(batcher.getResult(undefined));
        expect(elapsed()).to.equal(2 * TICK + 2, "Timing Results");
    });
    describe("maxBatchSize", () => {
        it("Core Functionality", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<number, string>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(TICK);
                    return input.map(String);
                },
                maxBatchSize: 2,
            });
            const elapsed = timeSpan();
            await fakeAwait(
                Promise.all(
                    [1, 5, 9].map(async (input, i) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(String(input), "Outputs");
                        expect(elapsed()).to.equal(TICK + Math.floor(i / 2), "Timing Results");
                    }),
                ),
            );
            expect(runCount).to.equal(2, "runCount");
        });
        it("Instant Start", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(TICK);
                    return input;
                },
                maxBatchSize: 2,
            });

            const runCounts = [0, 1, 1];
            await fakeAwait(
                Promise.all(
                    runCounts.map((expectedRunCount) => {
                        // The batching function should be triggered instantly when the max batch size is reached
                        const promise = batcher.getResult(undefined);
                        expect(runCount).to.equal(expectedRunCount);
                        return promise;
                    }),
                ),
            );
        });
    });
    it("queuingDelay", async () => {
        let runCount: number = 0;
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: async (input) => {
                runCount++;
                return new Array(input.length);
            },
            queuingDelay: TICK * 2,
        });
        const delays = [0, 1, 3];
        const elapsed = timeSpan();
        const results = await fakeAwait(
            Promise.all(
                delays.map(async (delay) => {
                    await wait(delay * TICK);
                    await batcher.getResult(undefined);
                    return elapsed();
                }),
            ),
        );
        expect(results).to.deep.equal([2 * TICK, 2 * TICK, 5 * TICK], "Timing Results");
        expect(runCount).to.equal(2, "runCount");
    });
    describe("queueingThresholds", () => {
        it("Core Functionality", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(5 * TICK);
                    return new Array(input.length);
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1, 2, 3, 4];
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    delays.map(async (delay) => {
                        await wait(delay * TICK);
                        await batcher.getResult(undefined);
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal(
                [5 * TICK + 1, 7 * TICK + 1, 7 * TICK + 1, 9 * TICK + 1, 9 * TICK + 1],
                "Timing Results",
            );
            expect(runCount).to.equal(3, "runCount");
        });
        it("Should Trigger On Batch Completion", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(2 * TICK);
                    return new Array(input.length);
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1];
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    delays.map(async (delay) => {
                        await wait(delay * TICK);
                        await batcher.getResult(undefined);
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([2 * TICK + 1, 4 * TICK + 2], "Timing Results");
        });
        it("Delay After Hitting Queuing Threshold", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(3 * TICK);
                    return new Array(input.length);
                },
                queuingDelay: TICK,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all([
                    (async () => {
                        await batcher.getResult(undefined);
                        await batcher.getResult(undefined);
                        return elapsed();
                    })(),
                    (async () => {
                        await wait(2 * TICK);
                        await batcher.getResult(undefined);
                        return elapsed();
                    })(),
                ]),
            );
            expect(results).to.deep.equal([8 * TICK, 8 * TICK], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Obey Queuing Threshold Even When Hitting maxBatchSize", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(TICK);
                    return new Array(input.length);
                },
                maxBatchSize: 1,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [0, 1].map(async () => {
                        await batcher.getResult(undefined);
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([TICK, 2 * TICK], "Timing Results");
        });
    });
    describe("Retries", () => {
        it("Full", async () => {
            let batchNumber = 0;
            let runCount = 0;
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(TICK);
                    batchNumber++;
                    if (batchNumber < 2) {
                        return inputs.map((): typeof BATCHER_RETRY_TOKEN => BATCHER_RETRY_TOKEN);
                    }
                    return inputs.map((input) => input + 1);
                },
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([2 * TICK + 2, 2 * TICK + 2], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Partial", async () => {
            let batchNumber = 0;
            let runCount = 0;
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(TICK);
                    batchNumber++;
                    return inputs.map((input, index) => {
                        return batchNumber < 2 && index < 1 ? BATCHER_RETRY_TOKEN : input + 1;
                    });
                },
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([2 * TICK + 2, TICK + 1], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Ordering", async () => {
            const batchInputs: number[][] = [];
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    batchInputs.push(inputs.slice());
                    await wait(TICK);
                    return inputs.map((input, index) => {
                        return batchInputs.length < 2 && index < 2 ? BATCHER_RETRY_TOKEN : input + 1;
                    });
                },
                maxBatchSize: 3,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2, 3, 4].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([2 * TICK, 2 * TICK, TICK, 2 * TICK], "Timing Results");
            expect(batchInputs).to.deep.equal(
                [
                    [1, 2, 3],
                    [1, 2, 4],
                ],
                "batchInputs",
            );
        });
    });
    describe("Send Method", () => {
        it("Single Use", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(TICK);
                    return inputs;
                },
                queuingDelay: TICK,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index === 1) {
                            expect(runCount).to.equal(0, "runCount before");
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after");
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([TICK, TICK, 3 * TICK], "Timing Results");
        });
        it("Effect Delayed By queuingThreshold", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(TICK);
                    return inputs;
                },
                queuingDelay: TICK,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index === 1) {
                            expect(runCount).to.equal(0, "runCount before");
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after");
                        } else if (index === 2) {
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after second");
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([TICK, TICK, 2 * TICK], "Timing Results");
        });
        it("Effect Delayed By delayFunction", async () => {
            // This tests that the effect of the send method still obeys the delayFunction and that the effect
            // lasts even after a previous batch has been delayed by the delayFunction.
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    await wait(TICK);
                    return inputs;
                },
                delayFunction: () => wait(TICK),
                maxBatchSize: 2,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index === 2) {
                            batcher.send();
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(results).to.deep.equal([2 * TICK, 2 * TICK, 4 * TICK], "Timing Results");
        });
        it("Interaction With Retries", async () => {
            // This tests that the effect of the send method lasts even after a retry
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(TICK);
                    return runCount === 1 ? inputs.map((): typeof BATCHER_RETRY_TOKEN => BATCHER_RETRY_TOKEN) : inputs;
                },
                queuingDelay: TICK,
                queuingThresholds: [1, Infinity],
            });
            const elapsed = timeSpan();
            const results = await fakeAwait(
                Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index >= 1) {
                            batcher.send();
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(runCount).to.equal(2, "runCount");
            expect(results).to.deep.equal([2 * TICK, 2 * TICK, 2 * TICK], "Timing Results");
        });
    });
    describe("Error Handling", () => {
        it("Single Rejection", async () => {
            const batcher = new Batcher<string, undefined>({
                batchingFunction: async (input) => {
                    await wait(TICK);
                    return input.map((value) => {
                        return value === "error" ? new Error("test") : undefined;
                    });
                },
            });

            const inputs = ["a", "error", "b"];
            const results = await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        try {
                            await batcher.getResult(input);
                            return true;
                        } catch (err) {
                            expect(err.message).to.equal("test");
                            return false;
                        }
                    }),
                ),
            );
            expect(results).to.deep.equal([true, false, true]);
        });
        it("Synchronous Batching Function Exception Followed By Success", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (input) => {
                    input.forEach((value) => {
                        if (value === 0) {
                            throw new Error("test");
                        }
                    });
                    return wait(1).then(() => new Array(input.length));
                },
                maxBatchSize: 2,
            });

            const inputs = [0, 1, 2];
            const results = await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        try {
                            await batcher.getResult(input);
                            return true;
                        } catch (err) {
                            expect(err.message).to.equal("test");
                            return false;
                        }
                    }),
                ),
            );
            expect(results).to.deep.equal([false, false, true]);
        });
        it("Asynchronous Batching Function Exception Followed By Success", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: async (input) => {
                    await wait(1);
                    input.forEach((value) => {
                        if (value === 0) {
                            throw new Error("test");
                        }
                    });
                    return new Array(input.length);
                },
                maxBatchSize: 2,
            });

            await fakeAwait(
                Promise.all(
                    [0, 1].map(async (input) => {
                        await expect(batcher.getResult(input)).to.be.rejectedWith(Error, "test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(1));
        });
        it("Synchronous Delay Exception Followed By Success", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(1);
                    return input;
                },
                delayFunction: () => {
                    runCount++;
                    if (runCount < 2) {
                        throw new Error("test");
                    }
                },
                maxBatchSize: 2,
            });

            await fakeAwait(
                Promise.all(
                    [0, 1].map(async () => {
                        await expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(undefined));
        });
        it("Asynchronous Delay Exception Followed By Success", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(1);
                    return input;
                },
                delayFunction: async () => {
                    await wait(1);
                    runCount++;
                    if (runCount < 2) {
                        throw new Error("test");
                    }
                },
                maxBatchSize: 2,
            });

            await fakeAwait(
                Promise.all(
                    [0, 1].map(async () => {
                        await expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(undefined));
        });
        it("Invalid Output Type", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (_input) => {
                    return "test" as unknown as undefined[];
                },
            });

            const inputs = [0, 1, 2];
            await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        await expect(batcher.getResult(input)).to.be.rejectedWith(
                            /^batchingFunction must return an array$/,
                        );
                    }),
                ),
            );
        });
        it("Invalid Output Length", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: async (input) => {
                    // Respond with an array larger than the input
                    await wait(1);
                    return new Array(input.length + 1);
                },
            });

            const inputs = [0, 1, 2];
            await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        expect(batcher.getResult(input)).to.be.rejectedWith(
                            Error,
                            /^batchingFunction output length does not equal the input length$/,
                        );
                    }),
                ),
            );
        });
    });
    describe("Invalid Options", () => {
        it("options.maxBatchSize < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        maxBatchSize: 0,
                    }),
            ).to.throw(/^options\.maxBatchSize must be greater than 0$/);
        });
        it("options.queuingThresholds.length = 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingThresholds: [],
                    }),
            ).to.throw(/^options\.queuingThresholds must contain at least one number$/);
        });
        it("options.queuingThresholds[*] < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingThresholds: [0],
                    }),
            ).to.throw(/^options.queuingThresholds must only contain numbers greater than 0$/);
        });
        it("options.queuingDelay < 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingDelay: -1,
                    }),
            ).to.throw(/^options.queuingDelay must be greater than or equal to 0$/);
        });
    });
    it("Typings", async () => {
        const options: BatcherOptions<number, string> = {
            // @ts-expect-error: invalid return type
            batchingFunction: async (input) => {
                expectType<TypeEqual<typeof input, readonly number[]>>(true);
                return input;
            },
        };
        expectType<TypeEqual<BatchingResult<string>, string | Error | typeof BATCHER_RETRY_TOKEN>>(true);
        const batcher = new Batcher<number, string>(options);
        expectType<TypeEqual<Parameters<typeof batcher["getResult"]>, [number]>>(true);
        expectType<TypeEqual<ReturnType<typeof batcher["getResult"]>, Promise<string>>>(true);
    });
});
