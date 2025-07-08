// EventEmitter base for typed events

export type Listener<T extends any[]> = (...args: T) => void;

export class TypedEventEmitter<Events extends Record<string, (...args: any[]) => void>> {
    private listeners: { [K in keyof Events]?: Array<Events[K]> } = {};

    on<K extends keyof Events>(event: K, listener: Events[K]): this {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event]!.push(listener);
        return this;
    }

    off<K extends keyof Events>(event: K, listener: Events[K]): this {
        if (!this.listeners[event]) return this;
        this.listeners[event] = this.listeners[event]!.filter((l) => l !== listener);
        return this;
    }

    emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean {
        if (!this.listeners[event]) return false;
        for (const listener of this.listeners[event]!) {
            listener(...args);
        }
        return true;
    }
}
