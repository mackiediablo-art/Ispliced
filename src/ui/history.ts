/** Session history keeps complete browse state; new navigation discards forward entries. */
export class NavigationHistory<T> {
  private entries: { key: string; value: T }[] = [];
  private index = -1;

  get canBack() { return this.index > 0; }
  get canForward() { return this.index < this.entries.length - 1; }
  get current() { return this.entries[this.index]?.value; }

  push(key: string, value: T) {
    if (this.entries[this.index]?.key === key) return false;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ key, value });
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  update(value: T) {
    if (this.index >= 0) this.entries[this.index].value = value;
  }

  move(direction: -1 | 1): T | undefined {
    const index = this.index + direction;
    if (index < 0 || index >= this.entries.length) return;
    this.index = index;
    return this.current;
  }
}
