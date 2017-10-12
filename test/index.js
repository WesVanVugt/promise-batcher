"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai = require("chai");
const chai_1 = require("chai");
const chaiAsPromised = require("chai-as-promised");
const Debug = require("debug");
const index_1 = require("../index");
const debug = Debug("promise-batcher:test");
chai.use(chaiAsPromised);
// Verify that the types needed can be imported
const typingImportTest = undefined;
if (typingImportTest) {
    // do nothing
}
/**
 * Milliseconds per tick.
 */
const tick = 100;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance = 60;
/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time) {
    if (time <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}
/**
 * Expects an array of result times (ms) to be within the tolerance range of the specified numbers of target ticks.
 */
function expectTimes(resultTimes, targetTicks, message) {
    chai_1.expect(resultTimes).to.have.lengthOf(targetTicks.length, message);
    resultTimes.forEach((val, i) => {
        chai_1.expect(val).to.be.within(targetTicks[i] * tick, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
    });
}
function unhandledRejectionListener(err) {
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
        let runCount = 0;
        const batcher = new index_1.Batcher({
            batchingFunction: (input) => {
                runCount++;
                return wait(tick).then(() => input.map(String));
            },
        });
        const inputs = [1, 5, 9];
        const start = Date.now();
        return Promise.all(inputs.map((input) => {
            return batcher.getResult(input).then((output) => {
                chai_1.expect(output).to.equal(String(input), "Outputs");
                expectTimes([Date.now() - start], [1], "Timing Results");
            });
        })).then(() => {
            chai_1.expect(runCount).to.equal(1, "runCount");
        });
    });
    it("Offset Batches", () => {
        // Runs two batches of requests, offset so the seconds starts while the first is half finished.
        // The second batch should start before the first finishes.
        const start = Date.now();
        let runCount = 0;
        const batcher = new index_1.Batcher({
            batchingFunction: (input) => {
                runCount++;
                return wait(tick * 2).then(() => input.map(String));
            },
        });
        const inputs = [[1, 9], [5, 7]];
        return Promise.all(inputs.map((input, index) => {
            return wait(index * tick).then(() => Promise.all(input.map((value, index2) => {
                return batcher.getResult(value).then((result) => {
                    chai_1.expect(result).to.equal(String(value));
                    expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
                });
            })));
        })).then(() => {
            chai_1.expect(runCount).to.equal(2, "runCount");
        });
    });
    it("Delay Function", () => {
        let runCount = 0;
        const batcher = new index_1.Batcher({
            batchingFunction: (input) => {
                runCount++;
                return wait(1).then(() => input);
            },
            delayFunction: () => wait(tick),
            maxBatchSize: 2,
        });
        const inputs = [1, 5, 9];
        const start = Date.now();
        return Promise.all(inputs.map(() => {
            return batcher.getResult(undefined).then(() => Date.now() - start);
        })).then((times) => {
            expectTimes(times, [1, 1, 2], "Timing Results");
            chai_1.expect(runCount).to.equal(2, "runCount");
        });
    });
    describe("maxBatchSize", () => {
        it("Core Functionality", () => {
            let runCount = 0;
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(tick).then(() => input.map(String));
                },
                maxBatchSize: 2,
            });
            const inputs = [1, 5, 9];
            const start = Date.now();
            return Promise.all(inputs.map((input) => {
                return batcher.getResult(input).then((output) => {
                    chai_1.expect(output).to.equal(String(input), "Outputs");
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
            })).then(() => {
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Instant Start", () => {
            let runCount = 0;
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(tick).then(() => input);
                },
                maxBatchSize: 2,
            });
            const runCounts = [0, 1, 1];
            return Promise.all(runCounts.map((expectedRunCount) => {
                // The batching function should be triggered instantly when the max batch size is reached
                const promise = batcher.getResult(undefined);
                chai_1.expect(runCount).to.equal(expectedRunCount);
                return promise;
            }));
        });
    });
    it("queuingDelay", () => {
        let runCount = 0;
        const batcher = new index_1.Batcher({
            batchingFunction: (input) => {
                runCount++;
                return Promise.resolve(new Array(input.length));
            },
            queuingDelay: tick * 2,
        });
        const delays = [0, 1, 3];
        const start = Date.now();
        return Promise.all(delays.map((delay) => {
            return wait(delay * tick)
                .then(() => batcher.getResult(undefined))
                .then(() => Date.now() - start);
        })).then((results) => {
            expectTimes(results, [2, 2, 5], "Timing Results");
            chai_1.expect(runCount).to.equal(2, "runCount");
        });
    });
    describe("queueingThresholds", () => {
        it("Core Functionality", () => {
            let runCount = 0;
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(5 * tick).then(() => new Array(input.length));
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1, 2, 3, 4];
            const start = Date.now();
            return Promise.all(delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => batcher.getResult(undefined))
                    .then(() => Date.now() - start);
            })).then((results) => {
                expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
                chai_1.expect(runCount).to.equal(3, "runCount");
            });
        });
        it("Should Trigger On Batch Completion", () => {
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    return wait(2 * tick).then(() => new Array(input.length));
                },
                queuingThresholds: [1, 2],
            });
            const delays = [0, 1];
            const start = Date.now();
            return Promise.all(delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => batcher.getResult(undefined))
                    .then(() => Date.now() - start);
            })).then((results) => {
                expectTimes(results, [2, 4], "Timing Results");
            });
        });
        it("Delay After Hitting Queuing Threshold", () => {
            let runCount = 0;
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    runCount++;
                    return wait(3 * tick).then(() => new Array(input.length));
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const start = Date.now();
            return Promise.all([
                batcher.getResult(undefined).then(() => {
                    return batcher.getResult(undefined);
                }),
                wait(2 * tick).then(() => batcher.getResult(undefined)),
            ].map((promise) => promise.then(() => Date.now() - start))).then((results) => {
                expectTimes(results, [8, 8], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Obey Queuing Threshold Even When Hitting maxBatchSize", () => {
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    return wait(tick).then(() => new Array(input.length));
                },
                maxBatchSize: 1,
                queuingThresholds: [1, Infinity],
            });
            const start = Date.now();
            return Promise.all([
                batcher.getResult(undefined),
                batcher.getResult(undefined),
            ].map((promise) => promise.then(() => Date.now() - start))).then((results) => {
                expectTimes(results, [1, 2], "Timing Results");
            });
        });
    });
    describe("Error Handling", () => {
        it("Single Rejection", () => {
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    return wait(tick).then(() => input.map((value) => {
                        return value === "error" ? new Error("test") : undefined;
                    }));
                },
            });
            const inputs = ["a", "error", "b"];
            return Promise.all(inputs.map((input) => {
                return batcher.getResult(input).then(() => true).catch((err) => {
                    chai_1.expect(err.message).to.equal("test");
                    return false;
                });
            })).then((results) => {
                chai_1.expect(results).to.deep.equal([true, false, true]);
            });
        });
        it("Synchronous Batching Function Exception Followed By Success", () => {
            const batcher = new index_1.Batcher({
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
            return Promise.all(inputs.map((input) => {
                return batcher.getResult(input).then(() => true).catch((err) => {
                    chai_1.expect(err.message).to.equal("test");
                    return false;
                });
            })).then((results) => {
                chai_1.expect(results).to.deep.equal([false, false, true]);
            });
        });
        it("Asynchronous Batching Function Exception Followed By Success", () => {
            const batcher = new index_1.Batcher({
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
            return Promise.all([0, 1].map((input) => {
                const promise = batcher.getResult(input);
                if (input !== 2) {
                    return chai_1.expect(promise).to.be.rejectedWith(Error, "test");
                }
                return promise;
            }));
        });
        it("Synchronous Delay Exception Followed By Success", () => __awaiter(this, void 0, void 0, function* () {
            let runCount = 0;
            const batcher = new index_1.Batcher({
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
            return Promise.all([0, 1].map(() => {
                return chai_1.expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
            })).then(() => batcher.getResult(undefined));
        }));
        it("Asynchronous Delay Exception Followed By Success", () => {
            let runCount = 0;
            const batcher = new index_1.Batcher({
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
            return Promise.all([0, 1].map(() => {
                return chai_1.expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
            })).then(() => batcher.getResult(undefined));
        });
        it("Invalid Output Length", () => {
            const batcher = new index_1.Batcher({
                batchingFunction: (input) => {
                    // Respond with an array larger than the input
                    return wait(1).then(() => new Array(input.length + 1));
                },
            });
            const inputs = [0, 1, 2];
            return Promise.all(inputs.map((input) => {
                return batcher.getResult(input).then(() => true).catch(() => false);
            })).then((results) => {
                chai_1.expect(results).to.deep.equal([false, false, false]);
            });
        });
    });
});
