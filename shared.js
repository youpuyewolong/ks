const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const format = s => `${Math.floor((s || 0) / 60).toString().padStart(2,'0')}:${Math.floor((s || 0) % 60).toString().padStart(2,'0')}`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(url, method = 'GET', data) { const res = await fetch(url, { method, headers: data === undefined ? {} : { 'Content-Type':'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }); const value = await res.json(); if (!res.ok) throw Object.assign(new Error(value.error || '请求失败'), { status:res.status }); return value; }
function cover(story) { return story.cover_url ? `<img src="${esc(story.cover_url)}" alt="${esc(story.title)}的封面" loading="lazy">` : art(({ '睡前故事':'bear', '童话冒险':'planet', '国学经典':'mountain', '科普百科':'dino' })[story.category] || 'audio', '#e4e7d5'); }
function guarded(fn) { return async (...args) => { try { await fn(...args); } catch (e) { toast(e.message || '操作失败，请重试'); } }; }
