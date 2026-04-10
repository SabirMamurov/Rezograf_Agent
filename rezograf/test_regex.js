const val = 'Ягодная пастила черничная с добавлением ядра кешью';
const rx = /ООО|ИП|област|хранить|срок|масса|вес|дата|количество|упаковано|шоу\s*бокс|^\d+$/i;
console.log('Regex matched:', rx.test(val));

const m = val.match(rx);
if (m) console.log('Matched string:', m[0]);
