import chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import Debug from "debug";
import { Batcher, BATCHER_RETRY_TOKEN, BatcherOptions, BatcherToken, BatchingResult } from "../index";
const debug = Debug("promise-batcher:test");
chai.use(chaiAsPromised);

// Verify that the types needed can be imported
const typingImportTest: BatcherOptions<any, any> | BatchingResult<any> | BatcherToken = undefined as any;
if (typingImportTest) {
    // do nothing
}

/**
 * Milliseconds per tick.
 */
const tick: number = 100;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance: number = 60;

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
        expect(val).to.be.within(targetTicks[i] * tick, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
    });
}

function unhandledRejectionListener(err: any) {
    debug("unhandledRejectionListener: " + err.stack);
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + err.message);
}

beforeEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
});

describe("Batcher", () => {
    it("Core Functionality", () => {
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: (input) => {
                runCount++;
                return wait(tick).then(() => input.map(String));
            },
        });
        const inputs = [1, 5, 9];
        const start: number = Date.now();
        return Promise.all(
            inputs.map((input) => {
                return batcher.getResult(input).then((output) => {
                    expect(output).to.equal(String(input), "Outputs");
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
            }),
        ).then(() => {
            expect(runCount).to.equal(1, "runCount");
        });
    });
    it("Offset Batches", () => {
        // Runs two batches of requests, offset so the seconds starts while the first is half finished.
        // The second batch should start before the first finishes.
        const start: number = Date.now();
        let runCount: number = 0;
        const batcher = new Batcher<number, string>({
            batchingFunction: (input) => {
                runCount++;
                return wait(tick * 2).then(() => input.map(String));
            },
        });
        const inputs = [[1, 9], [5, 7]];
        return Promise.all(
            inputs.map((input, index) => {
                return wait(index * tick).then(() =>
                    Promise.all(
                        input.map((value, index2) => {
                            return batcher.getResult(value).then((result) => {
                                expect(result).to.equal(String(value));
                                expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
                            });
                        }),
                    ),
                );
            }),
        ).then(() => {
            expect(runCount).to.equal(2, "runCount");
        });
    });
    it("Delay Function", () => {
        let runCount: number = 0;
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: (input) => {
                runCount++;
                return wait(1).then(() => input);
            },
            delayFunction: () => wait(tick),
            maxBatchSize: 2,
        });
        const inputs = [1, 5, 9];
        const start: number = Date.now();
        return Promise.all(
            inputs.map(() => {
                return batcher.getResult(undefined).then(() => Date.now() - start);
            }),
        ).then((times) => {
            expectTimes(times, [1, 1, 2], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
    });
    describe("maxBatchSize", () => {
        it("Core Functionality", () => {
            let runCount: number = 0;
            const batcher = new Batcher<number, string>({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(tick).then(() => input.map(String));
                },
                maxBatchSize: 2,
            });
            const inputs = [1, 5, 9];
            const start: number = Date.now();
            return Promise.all(
                inputs.map((input) => {
                    return batcher.getResult(input).then((output) => {
                        expect(output).to.equal(String(input), "Outputs");
                        expectTimes([Date.now() - start], [1], "Timing Results");
                    });
                }),
            ).then(() => {
                expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Instant Start", () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(tick).then(() => input);
                },
                maxBatchSize: 2,
            });

            const runCounts = [0, 1, 1];
            return Promise.all(
                runCounts.map((expectedRunCount) => {
                    // The batching function should be triggered instantly when the max batch size is reached
                    const promise = batcher.getResult(undefined);
                    expect(runCount).to.equal(expectedRunCount);
                    return promise;
                }),
            );
        });
    });
    it("queuingDelay", () => {
        let runCount: number = 0;
        const batcher = new Batcher<undefined, undefined>({
            batchingFunction: (input) => {
                runCount++;
                return Promise.resolve(new Array(input.length));
            },
            queuingDelay: tick * 2,
        });
        const delays = [0, 1, 3];
        const start: number = Date.now();
        return Promise.all(
            delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => batcher.getResult(undefined))
                    .then(() => Date.now() - start);
            }),
        ).then((results) => {
            expectTimes(results, [2, 2, 5], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
    });
    describe("queueingThresholds", () => {
        it("Core Functionality", () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(5 * tick).then(() => new Array(input.length));
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1, 2, 3, 4];
            const start: number = Date.now();
            return Promise.all(
                delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => batcher.getResult(undefined))
                        .then(() => Date.now() - start);
                }),
            ).then((results) => {
                expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
                expect(runCount).to.equal(3, "runCount");
            });
        });
        it("Should Trigger On Batch Completion", () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    return wait(2 * tick).then(() => new Array(input.length));
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1];
            const start: number = Date.now();
            return Promise.all(
                delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => batcher.getResult(undefined))
                        .then(() => Date.now() - start);
                }),
            ).then((results) => {
                expectTimes(results, [2, 4], "Timing Results");
            });
        });
        it("Delay After Hitting Queuing Threshold", () => {
            let runCount: number = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(3 * tick).then(() => new Array(input.length));
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const start: number = Date.now();
            return Promise.all(
                [
                    batcher.getResult(undefined).then(() => {
                        return batcher.getResult(undefined);
                    }),
                    wait(2 * tick).then(() => batcher.getResult(undefined)),
                ].map((promise) => promise.then(() => Date.now() - start)),
            ).then((results) => {
                expectTimes(results, [8, 8], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Obey Queuing Threshold Even When Hitting maxBatchSize", () => {
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    return wait(tick).then(() => new Array(input.length));
                },
                maxBatchSize: 1,
                queuingThresholds: [1, Infinity],
            });
            const start: number = Date.now();
            return Promise.all(
                [batcher.getResult(undefined), batcher.getResult(undefined)].map((promise) =>
                    promise.then(() => Date.now() - start),
                ),
            ).then((results) => {
                expectTimes(results, [1, 2], "Timing Results");
            });
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return Date.now() - start;
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return Date.now() - start;
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2, 3, 4].map(async (input) => {
                    const output = await batcher.getResult(input);
                    expect(output).to.equal(input + 1, "getResult output");
                    return Date.now() - start;
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index === 1) {
                        expect(runCount).to.equal(0, "runCount before");
                        batcher.send();
                        expect(runCount).to.equal(1, "runCount after");
                    }
                    await promise;
                    return Date.now() - start;
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
            const start = Date.now();
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
                    return Date.now() - start;
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index === 2) {
                        batcher.send();
                    }
                    await promise;
                    return Date.now() - start;
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
            const start = Date.now();
            const results = await Promise.all(
                [1, 2, 3].map(async (_, index) => {
                    const promise = batcher.getResult(undefined);
                    if (index >= 1) {
                        batcher.send();
                    }
                    await promise;
                    return Date.now() - start;
                }),
            );
            expect(runCount).to.equal(2, "runCount");
            expectTimes(results, [2, 2, 2], "Timing Results");
        });
    });
    describe("Error Handling", () => {
        it("Single Rejection", () => {
            const batcher = new Batcher<string, undefined>({
                batchingFunction: (input) => {
                    return wait(tick).then(() =>
                        input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        }),
                    );
                },
            });

            const inputs = ["a", "error", "b"];
            return Promise.all(
                inputs.map((input) => {
                    return batcher
                        .getResult(input)
                        .then(() => true)
                        .catch((err: Error) => {
                            expect(err.message).to.equal("test");
                            return false;
                        });
                }),
            ).then((results) => {
                expect(results).to.deep.equal([true, false, true]);
            });
        });
        it("Synchronous Batching Function Exception Followed By Success", () => {
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
            return Promise.all(
                inputs.map((input) => {
                    return batcher
                        .getResult(input)
                        .then(() => true)
                        .catch((err: Error) => {
                            expect(err.message).to.equal("test");
                            return false;
                        });
                }),
            ).then((results) => {
                expect(results).to.deep.equal([false, false, true]);
            });
        });
        it("Asynchronous Batching Function Exception Followed By Success", () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (input) => {
                    return wait(1).then(() => {
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        return new Array(input.length);
                    });
                },
                maxBatchSize: 2,
            });

            return Promise.all(
                [0, 1].map((input) => {
                    const promise = batcher.getResult(input);
                    if (input !== 2) {
                        return expect(promise).to.be.rejectedWith(Error, "test");
                    }
                    return promise;
                }),
            );
        });
        it("Synchronous Delay Exception Followed By Success", async () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    return wait(1).then(() => input);
                },
                delayFunction: () => {
                    runCount++;
                    if (runCount < 2) {
                        throw new Error("test");
                    }
                },
                maxBatchSize: 2,
            });

            return Promise.all(
                [0, 1].map(() => {
                    return expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                }),
            ).then(() => batcher.getResult(undefined));
        });
        it("Asynchronous Delay Exception Followed By Success", () => {
            let runCount = 0;
            const batcher = new Batcher<undefined, undefined>({
                batchingFunction: (input) => {
                    return wait(1).then(() => input);
                },
                delayFunction: () => {
                    return wait(1).then(() => {
                        runCount++;
                        if (runCount < 2) {
                            throw new Error("test");
                        }
                    });
                },
                maxBatchSize: 2,
            });

            return Promise.all(
                [0, 1].map(() => {
                    return expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                }),
            ).then(() => batcher.getResult(undefined));
        });
        it("Invalid Output Length", () => {
            const batcher = new Batcher<number, undefined>({
                batchingFunction: (input) => {
                    // Respond with an array larger than the input
                    return wait(1).then(() => new Array(input.length + 1));
                },
            });

            const inputs = [0, 1, 2];
            return Promise.all(
                inputs.map((input) => {
                    return batcher
                        .getResult(input)
                        .then(() => true)
                        .catch(() => false);
                }),
            ).then((results) => {
                expect(results).to.deep.equal([false, false, false]);
            });
        });
    });
});
