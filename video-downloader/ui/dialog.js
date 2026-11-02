// Promise-based modal dialogs built on <dialog>.
import { h } from './dom.js';

// fields: [{name, label, type:'text'|'select'|'checkbox'|'textarea'|'color', value, options:[{value,label}], hint, placeholder}]
// Resolves with the field values, or null when cancelled.
export function formDialog({ title, fields = [], body = null, okLabel = 'Save', cancelLabel = 'Cancel', danger = false, onInput = null }) {
  return new Promise((resolve) => {
    const inputs = {};
    const rows = fields.map((f) => {
      let input;
      if (f.type === 'select') {
        input = h('select', { name: f.name }, (f.options || []).map((o) => h('option', { value: o.value, text: o.label, selected: o.value === f.value })));
      } else if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox', name: f.name, checked: !!f.value });
        inputs[f.name] = input;
        return h('label', { class: 'check' }, input, h('span', { text: f.label }));
      } else if (f.type === 'textarea') {
        input = h('textarea', { name: f.name, rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = f.value || '';
      } else {
        input = h('input', { type: f.type || 'text', name: f.name, placeholder: f.placeholder || '', maxlength: f.maxlength || 300, required: !!f.required });
        input.value = f.value ?? '';
      }
      inputs[f.name] = input;
      return h('label', { class: 'field' }, h('span', { text: f.label }), input, f.hint ? h('small', { text: f.hint }) : null);
    });
    const okBtn = h('button', { class: `btn primary${danger ? ' danger-fill' : ''}`, value: 'ok', type: 'submit', text: okLabel });
    const dlg = h('dialog', { class: 'modal' },
      h('form', { method: 'dialog' },
        h('h3', { text: title }),
        h('div', { class: 'body' }, body, rows),
        h('div', { class: 'foot' },
          cancelLabel ? h('button', { class: 'btn', value: 'cancel', type: 'submit', formnovalidate: true, text: cancelLabel }) : null,
          okBtn)));
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
    if (onInput) dlg.addEventListener('input', () => onInput(values(), dlg));
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const v = ok ? values() : null;
      dlg.remove();
      resolve(v);
    });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) { first.focus(); if (first.select) first.select(); }
    if (onInput) onInput(values(), dlg);
  });
}

export async function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  const res = await formDialog({ title, body: h('p', { style: { margin: 0 }, text: message }), okLabel, danger });
  return !!res;
}

export function infoDialog(title, body) {
  return formDialog({ title, body, okLabel: 'Close', cancelLabel: null });
}
