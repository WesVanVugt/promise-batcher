import chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import Debug from "debug";
import PromiseLikeClass from "promise-polyfill";
import timeSpan from "time-span";
import { Batcher, BATCHER_RETRY_TOKEN, BatcherOptions, BatcherToken, BatchingResult } from "./imports";
const debug = Debug("promise-batcher:test");
chai.use(chaiAsPromised);

// Verify that the types needed can be imported
const typingImportTest: BatcherOptions<any, any> | BatchingResult<any> | BatcherToken = undefined as any;
if (typingImportTest) {
    // do nothing
}

// Make the promise like the PromiseLike interface
delete PromiseLikeClass.prototype.catch;
delete PromiseLikeClass.prototype.finally;

/**
 * Milliseconds per tick.
 */
const tick: number = 60;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance: number = 50;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time: number): Promise<void> {
    if (time <= 0) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}

/**
 * Expects an array of result times (ms) to be within the tolerance range of the specified numbers of target ticks.
 */
function expectTimes(resultTimes: number[], targetTicks: number[], message: string) {
    expect(resultTimes).to.have.lengthOf(targetTicks.length, message);
    resultTimes.forEach((val, i) => {
        const targetTime = targetTicks[i] * tick;
        expect(val).to.be.within(targetTime - 1, targetTime + tolerance, message + " (" + i + ")");
    });
}

// istanbul ignore next
function unhandledRejectionListener(err: any) {
    debug("unhandledRejectionListener: " + err.stack);
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + err.message);
}

beforeEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
});

describe("Batcher", function() {
    // Timing can sometimes be inconsistent, so I allow retries
    this.retries(2);

    it("Core Functionality", async () => {
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: async (input) => {
                runCount++;
                await wait(tick);
                return input.map(String);
            },
        });
        const inputs = [1, 5, 9];
        const end = timeSpan();
        await Promise.all(
            inputs.map(async (input) => {
                const output = await batcher.getResult(input);
                expect(output).to.equal(String(input), "Outputs");
                expectTimes([end()], [1], "Timing Results");
            }),
        );
        expect(runCount).to.equal(1, "runCount");
    });
    it("Offset Batches", async () => {
        // Runs two batches of requests, offset so the seconds starts while the first is half finished.
        // The second batch should start before the first finishes.
        const end = timeSpan();
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: async (input) => {
                runCount++;
                await wait(tick * 2);
                return input.map(String);
            },
        });
        const inputs = [[1, 9], [5, 7]];
        await Promise.all(
            inputs.map(async (input, index) => {
                await wait(index * tick);
                await Promise.all(
                    input.map(async (value, index2) => {
                        const result = await batcher.getResult(value);
                        expect(result).to.equal(String(value));
                        expectTimes([end()], [index + 2], `Timing result (${index},${index2})`);
                    }),
                );
            }),
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
            delayFunction: () => wait(tick),
            maxBatchSize: 2,
        });
        const inputs = [1, 5, 9];
        const end = timeSpan();
        const times = await Promise.all(
            inputs.map(async () => {
                await batcher.getResult(undefined);
                return end();
            }),
        );
        expectTimes(times, [1, 1, 2], "Timing Results");
        expect(runCount).to.equal(2, "runCount");
    });
    it("Delay Function (PromiseLike)", async () => {
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: (input) => {
                return PromiseLikeClass.resolve(wait(tick)).then(() => input);
            },
            delayFunction: () => PromiseLikeClass.resolve(wait(tick)),
            maxBatchSize: 2,
        });
        const end = timeSpan();
        await batcher.getResult(undefined);
        expectTimes([end()], [2], "Timing Results");
    });
    describe("maxBatchSize", () => {
        it("Core Functionality", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<number, string>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(tick);
                    return input.map(String);
                },
                maxBatchSize: 2,
            });
            const inputs = [1, 5, 9];
            const end = timeSpan();
            await Promise.all(
                inputs.map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(String(input), "Outputs");
                    expectTimes([end()], [1], "Timing Results");
                }),
            );
            expect(runCount).to.equal(2, "runCount");
        });
        it("Instant Start", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(tick);
                    return input;
                },
                maxBatchSize: 2,
            });

            const runCounts = [0, 1, 1];
            await Promise.all(
                runCounts.map((expectedRunCount) => {
                    // The batching function should be triggered instantly when the max batch size is reached
                    const promise = batcher.getResult(undefined);
                    expect(runCount).to.equal(expectedRunCount);
                    return promise;
                }),
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
            queuingDelay: tick * 2,
        });
        const delays = [0, 1, 3];
        const end = timeSpan();
        const results = await Promise.all(
            delays.map(async (delay) => {
                await wait(delay * tick);
                await batcher.getResult(undefined);
                return end();
            }),
        );
        expectTimes(results, [2, 2, 5], "Timing Results");
        expect(runCount).to.equal(2, "runCount");
    });
    describe("queueingThresholds", () => {
        it("Core Functionality", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(5 * tick);
                    return new Array(input.length);
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1, 2, 3, 4];
            const end = timeSpan();
            const results = await Promise.all(
                delays.map(async (delay) => {
                    await wait(delay * tick);
                    await batcher.getResult(undefined);
                    return end();
                }),
            );
            expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
            expect(runCount).to.equal(3, "runCount");
        });
        it("Should Trigger On Batch Completion", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(2 * tick);
                    return new Array(input.length);
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1];
            const end = timeSpan();
            const results = await Promise.all(
                delays.map(async (delay) => {
                    await wait(delay * tick);
                    await batcher.getResult(undefined);
                    return end();
                }),
            );
            expectTimes(results, [2, 4], "Timing Results");
        });
        it("Delay After Hitting Queuing Threshold", async () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    runCount++;
                    await wait(3 * tick);
                    return new Array(input.length);
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all([
                (async () => {
                    await batcher.getResult(undefined);
                    await batcher.getResult(undefined);
                    return end();
                })(),
                (async () => {
                    await wait(2 * tick);
                    await batcher.getResult(undefined);
                    return end();
                })(),
            ]);
            expectTimes(results, [8, 8], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Obey Queuing Threshold Even When Hitting maxBatchSize", async () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (input) => {
                    await wait(tick);
                    return new Array(input.length);
                },
                maxBatchSize: 1,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
                [0, 1].map(async () => {
                    await batcher.getResult(undefined);
                    return end();
                }),
            );
            expectTimes(results, [1, 2], "Timing Results");
        });
    });
    describe("Retries", () => {
        it("Full", async () => {
            let batchNumber = 0;
            let runCount = 0;
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(tick);
                    batchNumber++;
                    if (batchNumber < 2) {
                        return inputs.map(() => BATCHER_RETRY_TOKEN);
                    }
                    return inputs.map((input) => input + 1);
                },
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return end();
                }),
            );
            expectTimes(results, [2, 2], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Partial", async () => {
            let batchNumber = 0;
            let runCount = 0;
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(tick);
                    batchNumber++;
                    return inputs.map((input, index) => {
                        return batchNumber < 2 && index < 1 ? BATCHER_RETRY_TOKEN : input + 1;
                    });
                },
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return end();
                }),
            );
            expectTimes(results, [2, 1], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Ordering", async () => {
            const batchInputs: number[][] = [];
            const batcher = new Batcher<number, number>({
                batchingFunction: async (inputs) => {
                    batchInputs.push(inputs);
                    await wait(tick);
                    return inputs.map((input, index) => {
                        return batchInputs.length < 2 && index < 2 ? BATCHER_RETRY_TOKEN : input + 1;
                    });
                },
                maxBatchSize: 3,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2, 3, 4].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return end();
                }),
            );
            expectTimes(results, [2, 2, 1, 2], "Timing Results");
            expect(batchInputs).to.deep.equal([[1, 2, 3], [1, 2, 4]], "batchInputs");
        });
    });
    describe("Send Method", () => {
        it("Single Use", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(tick);
                    return inputs;
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index === 1) {
                        expect(runCount).to.equal(0, "runCount before");
                        batcher.send();
                        expect(runCount).to.equal(1, "runCount after");
                    }
                    await promise;
                    return end();
                }),
            );
            expectTimes(results, [1, 1, 3], "Timing Results");
        });
        it("Effect Delayed By queuingThreshold", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(tick);
                    return inputs;
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
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
                    return end();
                }),
            );
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
        it("Effect Delayed By delayFunction", async () => {
            // This tests that the effect of the send method still obeys the delayFunction and that the effect
            // lasts even after a previous batch has been delayed by the delayFunction.
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    await wait(tick);
                    return inputs;
                },
                delayFunction: () => wait(tick),
                maxBatchSize: 2,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index === 2) {
                        batcher.send();
                    }
                    await promise;
                    return end();
                }),
            );
            expectTimes(results, [2, 2, 4], "Timing Results");
        });
        it("Interaction With Retries", async () => {
            // This tests that the effect of the send method lasts even after a retry
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: async (inputs) => {
                    runCount++;
                    await wait(tick);
                    return runCount === 1 ? inputs.map(() => BATCHER_RETRY_TOKEN) : inputs;
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index >= 1) {
                        batcher.send();
                    }
                    await promise;
                    return end();
                }),
            );
            expect(runCount).to.equal(2, "runCount");
            expectTimes(results, [2, 2, 2], "Timing Results");
        });
    });
    describe("Error Handling", () => {
        it("Single Rejection", async () => {
            const batcher = new Batcher<string, undefined>({
                batchingFunction: async (input) => {
                    await wait(tick);
                    return input.map((value) => {
                        return value === "error" ? new Error("test") : undefined;
                    });
                },
            });

            const inputs = ["a", "error", "b"];
            const results = await Promise.all(
                inputs.map(async (input) => {
                    try {
                        await batcher.getResult(input);
                        return true;
                    } catch (err) {
                        expect(err.message).to.equal("test");
                        return false;
                    }
                }),
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
            const results = await Promise.all(
                inputs.map(async (input) => {
                    try {
                        await batcher.getResult(input);
                        return true;
                    } catch (err) {
                        expect(err.message).to.equal("test");
                        return false;
                    }
                }),
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

            await Promise.all(
                [0, 1].map(async (input) => {
                    await expect(batcher.getResult(input)).to.be.rejectedWith(Error, "test");
                }),
            );
            await batcher.getResult(1);
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

            await Promise.all(
                [0, 1].map(async () => {
                    await expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                }),
            );
            await batcher.getResult(undefined);
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

            await Promise.all(
                [0, 1].map(async () => {
                    await expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                }),
            );
            await batcher.getResult(undefined);
        });
        it("Invalid Output Type", async () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (_input) => {
                    return "test" as any;
                },
            });

            const inputs = [0, 1, 2];
            await Promise.all(
                inputs.map(async (input) => {
                    await expect(batcher.getResult(input)).to.be.rejectedWith(
                        /^batchingFunction must return an array$/,
                    );
                }),
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
            await Promise.all(
                inputs.map(async (input) => {
                    expect(batcher.getResult(input)).to.be.rejectedWith(
                        Error,
                        /^batchingFunction output length does not equal the input length$/,
                    );
                }),
            );
        });
    });
    describe("Invalid Options", () => {
        it("options.maxBatchSize < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as any,
                        maxBatchSize: 0,
                    }),
            ).to.throw(/^options\.maxBatchSize must be greater than 0$/);
        });
        it("options.queuingThresholds.length = 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as any,
                        queuingThresholds: [],
                    }),
            ).to.throw(/^options\.queuingThresholds must contain at least one number$/);
        });
        it("options.queuingThresholds[*] < 1", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as any,
                        queuingThresholds: [0],
                    }),
            ).to.throw(/^options.queuingThresholds must only contain numbers greater than 0$/);
        });
        it("options.queuingDelay < 0", () => {
            expect(
                () =>
                    new Batcher({
                        batchingFunction: 1 as any,
                        queuingDelay: -1,
                    }),
            ).to.throw(/^options.queuingDelay must be greater than or equal to 0$/);
        });
    });
});
