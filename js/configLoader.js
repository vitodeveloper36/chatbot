// configLoader.js
export class ConfigLoader {
  constructor(url) {
    this.url = url;
  }

  async load() {
    const r = await fetch(this.url);
    if (!r.ok) throw new Error(`Config load failed: ${r.status}`);
    return await r.json();
  }
}
