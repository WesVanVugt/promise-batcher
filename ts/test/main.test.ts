import PromiseLikeClass from "promise-polyfill";
import timeSpan from "time-span";
import { expectType, TypeEqual } from "ts-expect";
import { Batcher, BATCHER_RETRY_TOKEN, BatcherOptions, BatchingResult } from "./imports";

// Make the promise like the PromiseLike interface
// @ts-expect-error: deleting a required type
delete PromiseLikeClass.prototype.catch;
// @ts-expect-error: deleting a required type
delete PromiseLikeClass.prototype.finally;

/**
 * Milliseconds per tick.
 */
const TICK = 100;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
const wait = (ms: number) =>
    new Promise<void>((res) => {
        setTimeout(res, ms);
    });

/**
 * Maximum number of timers to advance before giving up. This is used to prevent infinite loops.
 */
const MAX_TIMER_ADVANCE = 100;

/**
 * Uses fake timers to wait for a promise to complete.
 */
async function fakeAwait<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    try {
        const v = await Promise.race([
            promise,
            (async () => {
                for (let timerCount = 0; timerCount < MAX_TIMER_ADVANCE; timerCount++) {
                    for (let i = 0; i < 10; i++) {
                        await Promise.resolve();
                    }
                    if (done) {
                        // exit the timer loop; this error should never be caught
                        throw new Error("fakeAwait: done");
                    }
                    if (jest.getTimerCount() === 0) {
                        throw new Error("fakeAwait: no timers to advance");
                    }
                    jest.advanceTimersToNextTimer();
                }
                throw new Error("fakeAwait: too many timers");
            })(),
        ]);
        done = true;
        return v;
    } catch (err: unknown) {
        done = true;
        throw err;
    }
}

beforeAll(() => {
    jest.useFakeTimers();
});

beforeEach(() => {
    jest.clearAllTimers();
});

describe("Batcher", () => {
    test("Core Functionality", async () => {
        let runCount = 0;
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
                    expect(output).toBe(String(input));
                    expect(elapsed()).toBe(TICK + 1);
                }),
            ),
        );
        expect(runCount).toBe(1);
    });
    test("Offset Batches", async () => {
        // Runs two batches of requests, offset so the seconds starts while the first is half finished.
        // The second batch should start before the first finishes.
        const elapsed = timeSpan();
        let runCount = 0;
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
        const times = await fakeAwait(
            Promise.all(
                inputs.map(async (input, index) => {
                    await wait(index * TICK);
                    return Promise.all(
                        input.map(async (value) => {
                            const result = await batcher.getResult(value);
                            expect(result).toBe(String(value));
                            return elapsed();
                        }),
                    );
                }),
            ),
        );
        expect(times).toStrictEqual([
            [2 * TICK + 1, 2 * TICK + 1],
            [3 * TICK + 1, 3 * TICK + 1],
        ]);
        expect(runCount).toBe(2);
    });
    test("Delay Function", async () => {
        let runCount = 0;
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
        expect(times).toStrictEqual([TICK + 1, TICK + 1, 2 * TICK + 2]);
        expect(runCount).toBe(2);
    });

    test("Delay Function (PromiseLike)", async () => {
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: (input) => {
                return PromiseLikeClass.resolve(wait(TICK)).then(() => input);
            },
            delayFunction: () => PromiseLikeClass.resolve(wait(TICK)),
            maxBatchSize: 2,
        });
        const elapsed = timeSpan();
        await fakeAwait(batcher.getResult(undefined));
        expect(elapsed()).toBe(2 * TICK + 2);
    });

    describe("options.maxBatchSize", () => {
        test("Core Functionality", async () => {
            let runCount = 0;
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
                        expect(output).toBe(String(input));
                        expect(elapsed()).toBe(TICK + Math.floor(i / 2));
                    }),
                ),
            );
            expect(runCount).toBe(2);
        });
        test("Instant Start", async () => {
            let runCount = 0;
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
                        expect(runCount).toBe(expectedRunCount);
                        return promise;
                    }),
                ),
            );
        });
    });
    test("options.queuingDelay", async () => {
        let runCount = 0;
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: async (input) => {
                runCount++;
                return new Array<undefined>(input.length);
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
        expect(results).toStrictEqual([2 * TICK, 2 * TICK, 5 * TICK]);
        expect(runCount).toBe(2);
    });
    describe("options.queuingThresholds", () => {
        test("Core Functionality", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(5 * TICK);
                    return new Array<undefined>(input.length);
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
            expect(results).toStrictEqual([5 * TICK + 1, 7 * TICK + 1, 7 * TICK + 1, 9 * TICK + 1, 9 * TICK + 1]);
            expect(runCount).toBe(3);
        });
        test("Should Trigger On Batch Completion", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(2 * TICK);
                    return new Array<undefined>(input.length);
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
            expect(results).toStrictEqual([2 * TICK + 1, 4 * TICK + 2]);
        });
        test("Delay After Hitting Queuing Threshold", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(3 * TICK);
                    return new Array<undefined>(input.length);
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
            expect(results).toStrictEqual([8 * TICK, 8 * TICK]);
            expect(runCount).toBe(2);
        });
        test("Obey Queuing Threshold Even When Hitting maxBatchSize", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(TICK);
                    return new Array<undefined>(input.length);
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
            expect(results).toStrictEqual([TICK, 2 * TICK]);
        });
    });
    describe("Retries", () => {
        test("Full", async () => {
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
                        expect(output).toBe(input + 1);
                        return elapsed();
                    }),
                ),
            );
            expect(results).toStrictEqual([2 * TICK + 2, 2 * TICK + 2]);
            expect(runCount).toBe(2);
        });
        test("Partial", async () => {
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
                        expect(output).toBe(input + 1);
                        return elapsed();
                    }),
                ),
            );
            expect(results).toStrictEqual([2 * TICK + 2, TICK + 1]);
            expect(runCount).toBe(2);
        });
        test("Ordering", async () => {
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
                        expect(output).toBe(input + 1);
                        return elapsed();
                    }),
                ),
            );
            expect(results).toStrictEqual([2 * TICK, 2 * TICK, TICK, 2 * TICK]);
            expect(batchInputs).toStrictEqual([
                [1, 2, 3],
                [1, 2, 4],
            ]);
        });
    });
    describe(".prototype.send", () => {
        test("Single Use", async () => {
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
                            expect(runCount).toBe(0);
                            batcher.send();
                            expect(runCount).toBe(1);
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(results).toStrictEqual([TICK, TICK, 3 * TICK]);
        });
        test("Effect Delayed By queuingThreshold", async () => {
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
                            expect(runCount).toBe(0);
                            batcher.send();
                            expect(runCount).toBe(1);
                        } else if (index === 2) {
                            batcher.send();
                            expect(runCount).toBe(1);
                        }
                        await promise;
                        return elapsed();
                    }),
                ),
            );
            expect(results).toStrictEqual([TICK, TICK, 2 * TICK]);
        });
        test("Effect Delayed By delayFunction", async () => {
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
            expect(results).toStrictEqual([2 * TICK, 2 * TICK, 4 * TICK]);
        });
        test("Interaction With Retries", async () => {
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
            expect(runCount).toBe(2);
            expect(results).toStrictEqual([2 * TICK, 2 * TICK, 2 * TICK]);
        });
    });
    describe(".prototype.idlePromise", () => {
        test("Nothing queued", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => inputs,
            });
            await batcher.idlePromise();
        });
        test("Waits for batches", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    await wait(TICK);
                    return inputs;
                },
                maxBatchSize: 1,
                queuingThresholds: [1, 9],
            });
            const elapsed = timeSpan();
            expect(batcher.idling).toBe(true);
            void batcher.getResult(undefined);
            expect(batcher.idling).toBe(false);
            await fakeAwait(Promise.all([batcher.idlePromise(), batcher.idlePromise(), batcher.getResult(undefined)]));
            expect(batcher.idling).toBe(true);
            expect(elapsed()).toBe(2 * TICK);
        });
    });
    describe("Error Handling", () => {
        test("Single Rejection", async () => {
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
                        } catch (err: unknown) {
                            expect((err as Error).message).toBe("test");
                            return false;
                        }
                    }),
                ),
            );
            expect(results).toStrictEqual([true, false, true]);
        });
        test("Synchronous Batching Function Exception Followed By Success", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (input) => {
                    if (input.includes(0)) {
                        throw new Error("test");
                    }
                    return wait(1).then(() => new Array<undefined>(input.length));
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
                        } catch (err: unknown) {
                            expect((err as Error).message).toBe("test");
                            return false;
                        }
                    }),
                ),
            );
            expect(results).toStrictEqual([false, false, true]);
        });
        test("Asynchronous Batching Function Exception Followed By Success", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: async (input) => {
                    await wait(1);
                    input.forEach((value) => {
                        if (value === 0) {
                            throw new Error("test");
                        }
                    });
                    return new Array<undefined>(input.length);
                },
                maxBatchSize: 2,
            });

            await fakeAwait(
                Promise.all(
                    [0, 1].map(async (input) => {
                        await expect(batcher.getResult(input)).rejects.toThrowError("test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(1));
        });
        test("Synchronous Delay Exception Followed By Success", async () => {
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
                        await expect(batcher.getResult(undefined)).rejects.toThrowError("test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(undefined));
        });
        test("Asynchronous Delay Exception Followed By Success", async () => {
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
                        await expect(batcher.getResult(undefined)).rejects.toThrowError("test");
                    }),
                ),
            );
            await fakeAwait(batcher.getResult(undefined));
        });
        test("Invalid Output Type", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: () => {
                    return "test" as unknown as undefined[];
                },
            });

            const inputs = [0, 1, 2];
            await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        await expect(batcher.getResult(input)).rejects.toThrowError(
                            /^batchingFunction must return an array$/,
                        );
                    }),
                ),
            );
        });
        test("Invalid Output Length", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: async (input) => {
                    // Respond with an array larger than the input
                    await wait(1);
                    return new Array<undefined>(input.length + 1);
                },
            });

            const inputs = [0, 1, 2];
            await fakeAwait(
                Promise.all(
                    inputs.map(async (input) => {
                        await expect(batcher.getResult(input)).rejects.toThrowError(
                            /^batchingFunction output length does not equal the input length$/,
                        );
                    }),
                ),
            );
        });
    });
    describe("Invalid Options", () => {
        test("options.maxBatchSize < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        maxBatchSize: 0,
                    }),
            ).toThrowError(/^options\.maxBatchSize must be greater than 0$/);
        });
        test("options.queuingThresholds.length = 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingThresholds: [],
                    }),
            ).toThrowError(/^options\.queuingThresholds must contain at least one number$/);
        });
        test("options.queuingThresholds[*] < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingThresholds: [0],
                    }),
            ).toThrowError(/^options.queuingThresholds must only contain numbers greater than 0$/);
        });
        test("options.queuingDelay < 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as unknown as () => [],
                        queuingDelay: -1,
                    }),
            ).toThrowError(/^options.queuingDelay must be greater than or equal to 0$/);
        });
    });
    test("Typings", async () => {
        const options: BatcherOptions<number, string> = {
            // @ts-expect-error: invalid return type
            batchingFunction: async (input) => {
                expectType<TypeEqual<typeof input, readonly number[]>>(true);
                return input;
            },
        };
        expectType<TypeEqual<BatchingResult<string>, string | Error | typeof BATCHER_RETRY_TOKEN>>(true);
        const batcher = new Batcher<number, string>(options);
        expectType<TypeEqual<Parameters<(typeof batcher)["getResult"]>, [number]>>(true);
        expectType<TypeEqual<ReturnType<(typeof batcher)["getResult"]>, Promise<string>>>(true);
    });
});
