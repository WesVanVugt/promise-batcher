[![GitHub Workflow](https://github.com/WesVanVugt/promise-batcher/actions/workflows/main.yml/badge.svg)](https://github.com/WesVanVugt/promise-batcher/actions/workflows/main.yml)
[![Install Size](https://packagephobia.now.sh/badge?p=promise-batcher)](https://packagephobia.now.sh/result?p=promise-batcher)

# promise-batcher

A module for batching individual promises to improve their collective efficiency.

For release notes, see the [changelog](https://github.com/WesVanVugt/promise-batcher/blob/master/changelog.md).

## Install

npm install promise-batcher

## Examples

Promise batcher is useful for batching requests made from branching execution paths.

### Basic Example

This example demonstrates a batcher which takes numbers as inputs, adds 1 to each and returns the result.
Note that while the getResult function is called multiple times, the batching function is only run once.
If the send method is not called, the batch will still be processed when Node.js idles.

```javascript
const { Batcher } = require("promise-batcher");
let runCount = 0;
const batcher = new Batcher({
  batchingFunction: (nums) => {
    runCount++;
    return Promise.resolve(
      nums.map((n) => {
        return n + 1;
      }),
    );
  },
});
// Send the batch of requests. This step is optional.
batcher.send();
const inputs = [1, 3, 5, 7];
// Start a series of individual requests
const promises = inputs.map((input) => batcher.getResult(input));
// Wait for all the requests to complete
Promise.all(promises).then((results) => {
  console.log(results); // [ 2, 4, 6, 8 ]
  // The requests were still done in a single run
  console.log(runCount); // 1
});
```

### Database Example

This example shows how a batcher could be used to combine individual requests made to a database. This is especially
useful when the requests need to be made independently of each other, allowing the requests to be made individually,
yet be processed as batches. Note that in a real-world example, it would be best to implement exponential backoff for
retried requests by using a delayFunction.

```javascript
const { Batcher, BATCHER_RETRY_TOKEN } = require("promise-batcher");
const batcher = new Batcher({
  batchingFunction: (recordIds) => {
    // Perform a batched request to the database with the inputs from getResult()
    return database.batchGet(recordIds).then((results) => {
      // Interpret the results from the request, returning an array of result values
      return results.map((result) => {
        if (result.error) {
          if (result.error.retryable) {
            // Retry the individual request (eg. request throttled)
            return BATCHER_RETRY_TOKEN;
          } else {
            // Reject the individual request (eg. record not found)
            return new Error(result.error.message);
          }
        } else {
          // Resolve the individual request
          return result.data;
        }
      });
    });
  },
});
// Send the batch of requests. This step is optional.
batcher.send();
const recordIds = ["ABC123", "DEF456", "HIJ789"];
// Start a series of individual requests
const promises = recordIds.map((recordId) => batcher.getResult(recordId));
// Wait for all the requests to complete
Promise.all(promises).then((results) => {
  // Use the results
});
```

## API Reference

### Object: Batcher

A tool for combining requests.

#### Constructor

**new Batcher(options)** - Creates a new batcher.

- options.**batchingFunction**(inputArray) - A function which is passed an array of request values, returning a
  promise which resolves to an array of response values. The request and response arrays must be of equal length. To
  reject an individual request, return an Error object (or class which extends Error) at the corresponding element in
  the response array. To retry an individual request, return the BATCHER_RETRY_TOKEN in the response array.
- options.**delayFunction**() - A function which can delay a batch by returning a promise which resolves when the
  batch should be run. If the function does not return a promise, no delay will be applied _(optional)_.
- options.**maxBatchSize** - The maximum number of requests that can be combined in a single batch _(optional)_.
- options.**queuingDelay** - The number of milliseconds to wait before running a batch of requests. This is used to
  allow time for the requests to queue up. Defaults to 1ms. This delay does not apply if the limit set by
  options.maxBatchSize is reached, or if batcher.send() is called. Note that since the batcher uses setTimeout to
  perform this delay, batches delayed by this will only be run when Node.js is idle, even if that means a longer delay
  _(optional)_.
- options.**queuingThresholds** - An array containing the number of requests that must be queued in order to trigger
  a batch request at each level of concurrency. For example [1, 5], would require at least 1 queued request when no
  batch requests are active, and 5 queued requests when 1 (or more) batch requests are active. Defaults to [1]. Note
  that the delay imposed by options.queuingDelay still applies when a batch request is triggered _(optional)_.

#### Methods

- batcher.**getResult**(input) - Returns a promise which resolves or rejects with the individual result returned from
  the batching function.
- batcher.**idlePromise**(input) - Returns a promise which resolves there are no pending batches.
- batcher.**send**() - Bypasses any queuingDelay set, while respecting all other limits imposed. If no other limits
  are set, this will result in the batchingFunction being run immediately. Note that batches will still be run even if
  this function is not called, once the queuingDelay or maxBatchSize is reached.

#### Properties

- batcher.**idling** - `true` when there are no pending batches, and `false` otherwise.

## License

[MIT](https://github.com/WesVanVugt/promise-batcher/blob/master/license)
