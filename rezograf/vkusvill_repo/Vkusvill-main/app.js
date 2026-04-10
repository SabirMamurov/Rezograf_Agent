/**
 * VkusVill Label & Barcode Generator
 * 
 * Формат штрихкода: [8536000010][MM][DD]
 * Для ВкусВилл дата идёт: месяц, затем день (ММДД)
 */

const PRODUCT = {
  prefix: '8536000010',
  shelfLifeMonths: 12
};

class LabelGenerator {
  constructor() {
    this.dateInput = document.getElementById('dateInput');
    this.generateBtn = document.getElementById('generateBtn');
    this.barcodeCanvas = document.getElementById('barcodeCanvas');
    this.barcodeNumber = document.getElementById('barcodeNumber');
    this.labelDate = document.getElementById('labelDate');
    this.printBtn = document.getElementById('printBtn');
    this.copyBtn = document.getElementById('copyBtn');
    this.btwBtn = document.getElementById('btwBtn');
    this.toast = document.getElementById('toast');

    this.init();
  }

  init() {
    // Default: today
    const today = new Date();
    this.dateInput.value = this.toInputFormat(today);

    // Generate initial barcode
    this.generate();

    // Events
    this.generateBtn.addEventListener('click', () => this.generate());
    this.dateInput.addEventListener('change', () => this.generate());
    this.dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.generate();
    });
    this.printBtn.addEventListener('click', () => window.print());
    this.copyBtn.addEventListener('click', () => this.copyCode());
    this.btwBtn.addEventListener('click', () => this.exportPDF());
  }

  toInputFormat(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Формирует 14-значный код: prefix + MM + DD
   */
  buildCode(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${PRODUCT.prefix}${mm}${dd}`;
  }

  generate() {
    const val = this.dateInput.value;
    if (!val) {
      this.showToast('⚠️ Выберите дату');
      return;
    }

    const date = new Date(val + 'T00:00:00');
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();

    // 1) Update date on label
    this.labelDate.textContent = `${dd}.${mm}.${yyyy}`;

    // 2) Build barcode code
    const code = this.buildCode(date);

    // 3) Render barcode
    try {
      JsBarcode(this.barcodeCanvas, code, {
        format: 'CODE128',
        width: 1,
        height: 35,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000'
      });
    } catch (err) {
      console.error('Barcode error:', err);
      this.showToast('❌ Ошибка генерации');
      return;
    }

    // 4) Display digits under barcode
    this.barcodeNumber.textContent = code;

    this.showToast(`✅ Этикетка обновлена: ${code}`);
  }

  async copyCode() {
    const code = this.barcodeNumber.textContent;
    try {
      await navigator.clipboard.writeText(code);
      this.showToast('📋 Скопировано: ' + code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      this.showToast('📋 Скопировано: ' + code);
    }
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('show'), 2500);
  }

  async exportPDF() {
    const code = this.barcodeNumber.textContent;
    if (!code || code === '85360000100304') {
      this.showToast('⚠️ Сначала сгенерируйте этикетку');
      return;
    }

    this.showToast('⏳ Создаю PDF...');

    try {
      const label = document.getElementById('labelPreview');
      const canvas = await html2canvas(label, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true
      });

      const { jsPDF } = window.jspdf;
      // Label size: 80mm x 110mm
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 110]
      });

      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, 80, 110);
      pdf.save(`VkusVill_Label_${code}.pdf`);

      this.showToast('📥 PDF скачан: ' + code);
    } catch (err) {
      console.error('PDF error:', err);
      this.showToast('❌ Ошибка создания PDF');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new LabelGenerator();
});
