// apiClient.js
export class ApiClient {
  constructor(url) {
    this.url = url;
  }

  async send(payload) {
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return await resp.json();
  }
}
