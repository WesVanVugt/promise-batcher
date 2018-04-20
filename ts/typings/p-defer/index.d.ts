interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value?: T | PromiseLike<T> | undefined) => void;
    reject: (reason?: any) => void;
}

declare module "p-defer" {
    function defer<T>(): Deferred<T>;
    export = defer;
}
