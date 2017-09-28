# promise-batcher

A module for batching individual promises to improve their collective efficiency.

For release notes, see the [CHANGELOG](https://github.com/baudzilla/promise-batcher/blob/master/CHANGELOG.md).

## Installation

npm install promise-batcher

## Examples

Promise batcher is useful for batching requests made from branching

### Basic Example

This example demonstrates a batcher which takes numbers as inputs, adds 1 to each and returns the result.
Note that while the getResult function is called multiple times, the batching function is only run once.
```javascript
const { Batcher } = require('promise-batcher');
let runCount = 0;
const batcher = new Batcher({
    batchingFunction: (nums) => {
        runCount++;
        return Promise.resolve(nums.map((n) => {
            return n + 1;
        }));
    }
});
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

This example shows how a batcher could be used to combile individual requests made to a database. This is especially useful when the requests need to be made independently of each other, allowing the requests to be made individually, yet be processed as batches.
```javascript
const { Batcher } = require('promise-batcher');
const batcher = new Batcher({
    batchingFunction: (recordIds) => {
        // Perform a batched request to the database with the inputs from getResult()
        return database.batchGet(recordIds).then((results) => {
            // Interpret the results from the request, returning an array of result values
            return results.map((result) => {
                if (result.success) {
                    // Resolve the individual request
                    return result.data;
                } else {
                    // Reject the individual request (eg. record not found)
                    return new Error(result.message);
                }
            });
        });
    }
});
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
  * options.**batchingFunction**(inputArray) - A function which is passed an array of request values, returning a promise which resolves to an array of response values. The request and response arrays must be of equal length. To reject an individual request, return an Error object (or class which extends Error) at the corresponding element in the response array.
  * options.**delayFunction**() - A function which can delay a batch by returning a promise which resolves when the batch should be run. If the function does not return a promise, no delay will be applied *(optional)*.
  * options.**maxBatchSize** - The maximum number of requests that can be combined in a single batch  *(optional)*.
  * options.**queuingDelay** - The number of milliseconds to wait before running a batch of requests. This is used to allow time for the requests to queue up. Defaults to 1ms. This delay does not apply if the limit set by options.maxBatchSize is reached *(optional)*.
  * options.**queuingThresholds** - An array containing the number of requests that must be queued in order to trigger a batch request at each level of concurrency. For example [1, 5], would require at least 1 queued request when no batch requests are active, and 5 queued requests when 1 (or more) batch requests are active. Defaults to [1]. Note that the delay imposed by options.queuingDelay still applies when a batch request is triggered *(optional)*.

#### Methods

* batcher.**getResult**(input) - Returns a promise which resolves or rejects with the individual result returned from the batching function..

## License

The MIT License (MIT)

Copyright (c) 2017 Wes van Vugt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
