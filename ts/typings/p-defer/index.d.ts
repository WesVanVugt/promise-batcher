declare module "p-defer" {
    namespace defer {
        interface Deferred<T> {
            promise: Promise<T>;
            resolve: (value?: T | PromiseLike<T> | undefined) => void;
            reject: (reason?: any) => void;
        }
    }

    function defer<T>(): defer.Deferred<T>;
    export = defer;
}
