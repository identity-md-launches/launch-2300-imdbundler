// A request-scoped directory, never a connected account or default signer.
export class ProviderDirectory {
  #active = false;
  #providers = new Map();
  discover() { this.clear(); this.#active = true; }
  clear() { this.#active = false; this.#providers.clear(); }
  entries() { return [...this.#providers.entries()]; }
  get(id) { return this.#providers.get(id); }
  accept(detail) {
    if (!this.#active || !detail || typeof detail.info?.uuid !== 'string'
      || !detail.info.uuid.trim() || detail.info.uuid.length > 100
      || typeof detail.info?.name !== 'string' || !detail.info.name.trim()
      || typeof detail.provider?.request !== 'function') return false;
    const id = detail.info.uuid;
    // A later announcement must never replace a provider the user already chose.
    if (this.#providers.has(id) || this.#providers.size >= 20) return false;
    this.#providers.set(id, Object.freeze({ name: detail.info.name.slice(0, 60), provider: detail.provider }));
    return true;
  }
}
