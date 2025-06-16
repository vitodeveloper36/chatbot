// utils.js
export class Utils {
  static createEl(tag, { className = '', text = '', html = false, attrs = {} } = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) html ? el.innerHTML = text : el.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  static scrollToBottom(el) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  static formatTime(date = new Date()) {
    let h = date.getHours() % 12 || 12;
    let m = date.getMinutes().toString().padStart(2, '0');
    let ampm = date.getHours() < 12 ? 'am' : 'pm';
    return `${h}:${m} ${ampm}`;
  }
}
