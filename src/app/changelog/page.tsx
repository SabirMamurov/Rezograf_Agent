"use client";

const LOGS = [
  {
    version: "v1.0.8",
    date: "28 Апреля 2026",
    title: "Хотфикс печати: возвращён bitmap для термопринтера",
    changes: [
      { type: "fix", text: "Кнопка «Печать» снова шлёт на принтер бинарное изображение, заранее подготовленное под 203 DPI термоголовки, а не PDF. Раньше PDF попадал в драйвер принтера, тот пересчитывал его в свой растр с антиалиасингом — отсюда были волнистый текст, серые пятна на составе и КБЖУ, плохо читаемые подписи на этикетке. Теперь термоголовка получает готовый 1-битный bitmap и печатает пиксель в пиксель, как было изначально." },
      { type: "fix", text: "Кнопка «PDF» (отдельная) работает как раньше — генерирует PDF для скачивания и предпросмотра. Изменение коснулось только прямой печати." },
      { type: "fix", text: "В коде и в инструкции для разработчиков закреплено: путь печати должен быть bitmap, не PDF — чтобы будущие перформанс-правки случайно не вернули ту же ошибку (это уже происходило дважды)." }
    ]
  },
  {
    version: "v1.0.7",
    date: "28 Апреля 2026",
    title: "Хотфикс: волнистый текст на термопечати",
    changes: [
      { type: "fix", text: "Возвращено качество растра для печати на термопринтере: разрешение исходного снимка увеличено с 36× до 144× от целевого. Раньше после бинаризации алгоритм nearest-neighbor выбирал по 1 пикселю из ~36, и на наклонных краях букв выбор скакал — текст получался волнистый, особенно на «Состав», «Хранение» и КБЖУ. Теперь окно 144 семпла, края глифов ровные." },
      { type: "fix", text: "В CLAUDE.md и в самом коде закреплено правило не снижать DSF ниже 12 для изображения — чтобы перформанс-правки в будущем не возвращали ту же ошибку." }
    ]
  },
  {
    version: "v1.0.6",
    date: "27 Апреля 2026",
    title: "Дублирование товара в другую папку",
    changes: [
      { type: "feature", text: "Кнопка «📋 Дублировать» в инспекторе товара. Открывает выбор папки и создаёт копию со всеми полями (название, состав, КБЖУ, штрихкод, артикулы, условия хранения и т.д.)." },
      { type: "feature", text: "После создания копия сразу открывается в режиме редактирования — остаётся только поменять артикул и сохранить. Один товар можно за минуту разнести по нескольким папкам с разными артикулами." }
    ]
  },
  {
    version: "v1.0.5",
    date: "27 Апреля 2026",
    title: "Хотфикс: печать с кириллическим артикулом",
    changes: [
      { type: "fix", text: "Если в артикуле есть кириллические буквы (например «МСС 50236», где «М» и «С» — русские), кнопки «Печать» и «PDF» больше не падают с ошибкой «Cannot convert argument to a ByteString». Имя файла теперь корректно кодируется по RFC 6266 и принимается браузером." }
    ]
  },
  {
    version: "v1.0.4",
    date: "27 Апреля 2026",
    title: "Второй артикул и адаптивный размер цифр",
    changes: [
      { type: "feature", text: "Добавлено поле «Артикул 2» — для сетей магазинов, где требуется два артикула на одной этикетке. Заполняется при создании или редактировании товара. Если оба артикула указаны, на этикетке они выводятся в столбик." },
      { type: "feature", text: "Размер цифр артикула теперь подстраивается под количество знаков и под наличие второго артикула: длинные строки больше не наезжают на штрихкод." },
      { type: "ui", text: "В каталоге появилась колонка «Артикул 2 (для сетей)» с инлайн-редактированием." },
      { type: "fix", text: "Поиск ищет и по второму артикулу — точное совпадение поднимает товар в выдаче так же, как и совпадение по основному." }
    ]
  },
  {
    version: "v1.0.3",
    date: "22 Апреля 2026",
    title: "Состав теперь виден в инспекторе товара",
    changes: [
      { type: "ui", text: "В инспекторе на странице «Печать этикеток» добавлено отображение поля «Состав» в режиме просмотра — раньше его можно было увидеть только при нажатии «Редактировать». Данные в базе не менялись (763 товара с непустым составом)." },
      { type: "fix", text: "Уточнение: на самой этикетке состав не печатается, если он совпадает с названием товара (защита от дублирования). Это поведение сохраняется." }
    ]
  },
  {
    version: "v1.0.2",
    date: "21 Апреля 2026",
    title: "Поиск с поддержкой кириллицы и стабилизация UI",
    changes: [
      { type: "fix", text: "Поиск теперь корректно находит товары на русском языке независимо от регистра («Кедровая комета», «КЕДРОВАЯ КОМЕТА» и т.д.) — исправлена обработка кириллицы в SQLite." },
      { type: "feature", text: "Поиск по нескольким словам: можно вводить слова в любом порядке — «комета кедровая» найдёт то же, что и «кедровая комета»." },
      { type: "ui", text: "Модальное окно «Создать этикетку» теперь корректно помещается на экранах любой высоты: шапка и кнопки закреплены, форма прокручивается внутри." },
      { type: "ui", text: "Поле поиска и выпадающий список результатов сделаны непрозрачными и выровнены по ширине поля ввода." },
      { type: "fix", text: "Устранена ошибка «Cannot update a component (Router) while rendering» при переходах между папками." },
      { type: "fix", text: "Кнопка «Печать» больше не выдаёт ошибку «Ошибка генерации PDF» — добавлено автоматическое восстановление при разрыве сессии Puppeteer." }
    ]
  },
  {
    version: "v1.0.1",
    date: "13 Апреля 2026",
    title: "Пиксель-перфектная настройка шаблонов печати",
    changes: [
      { type: "fix", text: "Отрегулирован интервал по вертикали и горизонтали для блок дат, устранено наложение текста при рендере (отказ от таблиц и абсолютной ширины)." },
      { type: "ui", text: "Добавлено безопасное автоматическое сжатие интервалов (min-width)." },
      { type: "perf", text: "Оптимизирована отрисовка шрифта Roboto Condensed на термопринтерах." }
    ]
  },
  {
    version: "v1.0.0",
    date: "10 Апреля 2026",
    title: "Финальный релиз и оптимизация светлой темы",
    changes: [
      { type: "feature", text: "Добавлена страница «Обновления системы» для просмотра истории версий." },
      { type: "fix", text: "Синхронизировано переключение тем: добавлен плавный единый переход между дневным и ночным стилем (Overlay Fade)." },
      { type: "fix", text: "Адаптирован цвет текста и фона в Каталоге продукции для светлой темы (устранен нечитаемый белый текст)." },
      { type: "fix", text: "Отключен значок Next.js Dev Indicator в режиме разработки." },
      { type: "perf", text: "Качественно улучшена производительность загрузки папок за счет новых параметризованных запросов к базе данных (StartsWith)." },
      { type: "ui", text: "Улучшен дизайн инспектора параметров, убраны «зависающие» темные прямоугольные блоки." }
    ]
  },
  {
    version: "v0.9.5",
    date: "9 Апреля 2026",
    title: "Оптимизация базы данных и каталогов",
    changes: [
      { type: "feature", text: "Внедрена архитектура светлой темы с CSS-переменными вместо жестко закодированных классов." },
      { type: "feature", text: "В таблицах файлов теперь отображается только название и артикул для большего удобства чтения длинных имен." },
      { type: "perf", text: "Ускорена навигация между папками: исключено чтение всех 1845 файлов в память." },
      { type: "ui", text: "Разработан новый градиентный логотип и переработана боковая панель навигации (Sidebar)." }
    ]
  },
  {
    version: "v0.9.0",
    date: "8 Апреля 2026",
    title: "Система печати и парсинг",
    changes: [
      { type: "feature", text: "Интегрирована генерация PDF для печати в BarTender." },
      { type: "feature", text: "Динамический масштаб этикеток: автоматический расчет под 70x90мм." },
      { type: "fix", text: "Исправлены баги парсинга папок и аномалии обработки дат КБЖУ." }
    ]
  }
];

export default function ChangelogPage() {
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-[var(--theme-workspace)] text-[var(--theme-text)] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden border border-[var(--theme-border)] relative animate-fade-in">
      {/* Top Bar */}
      <div className="flex items-center px-8 py-6 bg-[var(--color-surface-panel)]/80 backdrop-blur-xl border-b border-[var(--theme-border)] z-10 shrink-0">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent drop-shadow-sm">
            История обновлений
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">Официальные патчноуты и новые функции системы Rezograf</p>
        </div>
      </div>

      {/* Logs Scroll Area */}
      <div className="flex-1 overflow-y-auto p-8 z-10 relative">
        <div className="max-w-4xl mx-auto flex flex-col gap-8">
          {LOGS.map((log, index) => (
            <div key={log.version} className="relative pl-8">
              {/* Timeline dot */}
              <div className="absolute left-0 top-1.5 bottom-0 flex flex-col items-center">
                <div className={`w-3.5 h-3.5 rounded-full ${index === 0 ? "bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.6)]" : "bg-[var(--color-text-dim)]"}`}></div>
                {index !== LOGS.length - 1 && (
                  <div className="w-0.5 h-full bg-[var(--theme-border)] mt-2"></div>
                )}
              </div>

              {/* Card */}
              <div className="glass-card p-6 border-l-4 border-l-transparent hover:border-l-indigo-500 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-lg tracking-wider ${index === 0 ? "bg-indigo-500 text-white" : "bg-[var(--theme-overlay)] text-[var(--color-text-muted)] border border-[var(--theme-border)]"}`}>
                        {log.version}
                        {index === 0 && <span className="ml-1 text-[10px] uppercase opacity-80">— Актуальная</span>}
                      </span>
                      <span className="text-[13px] font-mono text-[var(--color-text-muted)]">{log.date}</span>
                    </div>
                    <h2 className="text-xl font-bold text-[var(--theme-text)] group-hover:text-indigo-400 transition-colors">{log.title}</h2>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  {log.changes.map((change, cIdx) => (
                    <div key={cIdx} className="flex items-start gap-3 bg-[var(--theme-overlay)] p-3 rounded-xl border border-[var(--theme-border)]">
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded shadow-sm shrink-0 mt-0.5
                        ${change.type === "feature" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : 
                          change.type === "fix" ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" : 
                          change.type === "perf" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : 
                          "bg-cyan-500/10 text-cyan-500 border border-cyan-500/20"}`}>
                        {change.type === "feature" ? "Новое" : change.type === "fix" ? "Фикс" : change.type === "perf" ? "Оптимизация" : "UI/UX"}
                      </span>
                      <span className="text-[13px] text-[var(--theme-text)] leading-relaxed opacity-90">{change.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
