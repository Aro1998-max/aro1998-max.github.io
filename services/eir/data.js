/* Конструктор EIR — база шаблонных требований.
   Источники: СП 333.1325800.2020 (табл. 5.1, 10.1, 11.2–11.4, 12.1, прил. Ж), СП 404.1325800.2018 (разд. 4–9),
   IFC4 ADD2 TC1 (ISO 16739-1:2018), buildingSMART IDS 1.0, BIM-стандарт Нанософт (2025).
   Формулировки нейтральные и написаны для этого сервиса. */
(function (root) {
  'use strict';
  var EIR = root.EIR = root.EIR || {};
  EIR.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  };

  /* Флаги элемента:
     st — 'both' (промежуточная и итоговая ЦИМ) | 'final' (только итоговая);
     k  — вид: 'build' строительный, 'space' помещение, 'seg' сегмент сети, 'fit' фасонная часть/арматура,
          'term' оконечное устройство, 'equip' оборудование, 'ins' изоляция, 'site' элемент территории;
     lb — несущий (Pset_*Common.LoadBearing), ext — наружный (IsExternal), ref — марка по спецификации (Reference),
     conc — железобетон (Pset_ConcreteElementGeneral.StrengthClass), mat — требовать материал,
     ids:false — элемент не проверяется через IDS (только в составе ЦИМ). */
  var MARKS = [
    { id: 'GP', code: 'ГП', lat: 'PP', name: 'Генеральный план', grp: 'Территория', gost: 'ГОСТ 21.508', inBld: false, def: false, el: [
      { n: 'Цифровая модель рельефа (существующая и проектная)', ifc: 'IFCGEOGRAPHICELEMENT', pt: 'TERRAIN', st: 'both', k: 'site' },
      { n: 'Проезды, тротуары, площадки (с конструкцией покрытия в итоговой ЦИМ)', ifc: 'IFCCIVILELEMENT', st: 'both', k: 'site', mat: true, note: 'класс уточняется в ПИМ' },
      { n: 'Подпорные стены, лестницы и пандусы на территории', ifc: 'IFCWALL', st: 'both', k: 'build', mat: true },
      { n: 'Ограждения территории, ворота, калитки', ifc: 'IFCRAILING', st: 'both', k: 'build' },
      { n: 'Озеленение', ifc: 'IFCGEOGRAPHICELEMENT', st: 'final', k: 'site', ids: false },
      { n: 'Малые архитектурные формы', ifc: 'IFCFURNITURE', st: 'final', k: 'site', ids: false },
      { n: 'Границы участка и зон с ограничениями (плоские элементы)', ifc: 'IFCGEOGRAPHICELEMENT', st: 'final', k: 'site', ids: false }
    ]},
    { id: 'AR', code: 'АР', lat: 'AR', name: 'Архитектурные решения', grp: 'Здание', gost: 'ГОСТ 21.501', inBld: true, def: true, el: [
      { n: 'Стены и перегородки (со структурой слоёв)', ifc: 'IFCWALL', st: 'both', k: 'build', ext: true, mat: true },
      { n: 'Навесные фасады и витражи', ifc: 'IFCCURTAINWALL', st: 'both', k: 'build', ext: true },
      { n: 'Двери и ворота (с зоной открывания)', ifc: 'IFCDOOR', st: 'both', k: 'build', ext: true, ref: true },
      { n: 'Окна', ifc: 'IFCWINDOW', st: 'both', k: 'build', ext: true, ref: true },
      { n: 'Полы (конструкция пола)', ifc: 'IFCCOVERING', pt: 'FLOORING', st: 'both', k: 'build', mat: true },
      { n: 'Потолки, в т.ч. подвесные', ifc: 'IFCCOVERING', pt: 'CEILING', st: 'both', k: 'build', mat: true },
      { n: 'Кровля', ifc: 'IFCROOF', st: 'both', k: 'build', ext: true },
      { n: 'Ограждения лестниц, балконов, кровли', ifc: 'IFCRAILING', st: 'both', k: 'build' },
      { n: 'Пандусы', ifc: 'IFCRAMP', st: 'both', k: 'build' },
      { n: 'Помещения', ifc: 'IFCSPACE', st: 'both', k: 'space' },
      { n: 'Отделка стен и колонн', ifc: 'IFCCOVERING', pt: 'CLADDING', st: 'final', k: 'build', mat: true },
      { n: 'Откосы, подоконники, отливы', ifc: 'IFCCOVERING', st: 'final', k: 'build', ids: false }
    ]},
    { id: 'KZH', code: 'КЖ', lat: 'SC', name: 'Конструкции железобетонные', grp: 'Здание', gost: 'ГОСТ 21.501', inBld: true, def: true, el: [
      { n: 'Фундаменты, ростверки', ifc: 'IFCFOOTING', st: 'both', k: 'build', lb: true, conc: true, mat: true },
      { n: 'Сваи', ifc: 'IFCPILE', st: 'both', k: 'build', lb: true, conc: true, mat: true },
      { n: 'Фундаментные плиты', ifc: 'IFCSLAB', pt: 'BASESLAB', st: 'both', k: 'build', lb: true, conc: true, mat: true },
      { n: 'Стены', ifc: 'IFCWALL', st: 'both', k: 'build', lb: true, ext: true, conc: true, mat: true },
      { n: 'Колонны, пилоны', ifc: 'IFCCOLUMN', st: 'both', k: 'build', lb: true, conc: true, mat: true },
      { n: 'Перекрытия и покрытия', ifc: 'IFCSLAB', pt: 'FLOOR', st: 'both', k: 'build', lb: true, ext: true, conc: true, mat: true },
      { n: 'Балки, ригели', ifc: 'IFCBEAM', st: 'both', k: 'build', lb: true, conc: true, mat: true },
      { n: 'Лестницы (марши и площадки)', ifc: 'IFCSTAIR', st: 'both', k: 'build', mat: true },
      { n: 'Отверстия и проёмы ≥ 200 мм', ifc: 'IFCOPENINGELEMENT', st: 'both', k: 'build', ids: false },
      { n: 'Отверстия и проёмы < 200 мм, закладные детали', ifc: 'IFCOPENINGELEMENT', st: 'final', k: 'build', ids: false }
    ]},
    { id: 'KM', code: 'КМ', lat: 'SS', name: 'Конструкции металлические', grp: 'Здание', gost: 'ГОСТ 21.502', inBld: true, def: false, el: [
      { n: 'Колонны, стойки', ifc: 'IFCCOLUMN', st: 'both', k: 'build', lb: true, mat: true },
      { n: 'Балки, прогоны', ifc: 'IFCBEAM', st: 'both', k: 'build', lb: true, mat: true },
      { n: 'Связи, раскосы', ifc: 'IFCMEMBER', pt: 'BRACE', st: 'both', k: 'build', mat: true },
      { n: 'Фермы (как сборки)', ifc: 'IFCELEMENTASSEMBLY', pt: 'TRUSS', st: 'both', k: 'build', ids: false },
      { n: 'Лестницы и площадки металлические', ifc: 'IFCSTAIR', st: 'both', k: 'build', mat: true },
      { n: 'Опорные плиты и фасонки узлов', ifc: 'IFCPLATE', st: 'final', k: 'build', mat: true },
      { n: 'Огнезащита конструкций', ifc: 'IFCCOVERING', pt: 'INSULATION', st: 'final', k: 'ins', mat: true }
    ]},
    { id: 'OV', code: 'ОВ', lat: 'HVC', name: 'Отопление, вентиляция и кондиционирование', grp: 'Инженерные системы', gost: 'ГОСТ 21.602', inBld: true, def: true, el: [
      { n: 'Воздуховоды', ifc: 'IFCDUCTSEGMENT', st: 'both', k: 'seg' },
      { n: 'Фасонные части воздуховодов', ifc: 'IFCDUCTFITTING', st: 'both', k: 'fit' },
      { n: 'Воздухораспределители', ifc: 'IFCAIRTERMINAL', st: 'both', k: 'term' },
      { n: 'Вентиляционные установки, кондиционеры', ifc: 'IFCUNITARYEQUIPMENT', st: 'both', k: 'equip' },
      { n: 'Вентиляторы', ifc: 'IFCFAN', st: 'both', k: 'equip' },
      { n: 'Трубопроводы отопления и холодоснабжения', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg' },
      { n: 'Отопительные приборы', ifc: 'IFCSPACEHEATER', st: 'both', k: 'term' },
      { n: 'Арматура, клапаны (в т.ч. противопожарные)', ifc: 'IFCVALVE', st: 'final', k: 'fit' },
      { n: 'Изоляция воздуховодов и трубопроводов', ifc: 'IFCCOVERING', pt: 'INSULATION', st: 'final', k: 'ins', mat: true },
      { n: 'Зоны обслуживания оборудования', ifc: 'IFCSPATIALZONE', st: 'both', k: 'space', ids: false }
    ]},
    { id: 'VK', code: 'ВК', lat: 'WS', name: 'Водоснабжение и канализация', grp: 'Инженерные системы', gost: 'ГОСТ 21.601', inBld: true, def: true, el: [
      { n: 'Трубопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg' },
      { n: 'Фасонные части трубопроводов', ifc: 'IFCPIPEFITTING', st: 'both', k: 'fit' },
      { n: 'Санитарные приборы', ifc: 'IFCSANITARYTERMINAL', st: 'both', k: 'term' },
      { n: 'Насосы', ifc: 'IFCPUMP', st: 'both', k: 'equip' },
      { n: 'Баки, водонагреватели', ifc: 'IFCTANK', st: 'both', k: 'equip' },
      { n: 'Арматура', ifc: 'IFCVALVE', st: 'final', k: 'fit' },
      { n: 'Изоляция трубопроводов', ifc: 'IFCCOVERING', pt: 'INSULATION', st: 'final', k: 'ins', mat: true }
    ]},
    { id: 'PT', code: 'ПТ', lat: 'FS', name: 'Пожаротушение', grp: 'Инженерные системы', gost: 'ГОСТ 21.601', inBld: true, def: false, el: [
      { n: 'Трубопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg' },
      { n: 'Оросители', ifc: 'IFCFIRESUPPRESSIONTERMINAL', pt: 'SPRINKLER', st: 'both', k: 'term' },
      { n: 'Пожарные краны', ifc: 'IFCFIRESUPPRESSIONTERMINAL', pt: 'HOSEREEL', st: 'both', k: 'term' },
      { n: 'Насосы', ifc: 'IFCPUMP', st: 'both', k: 'equip' },
      { n: 'Арматура, узлы управления', ifc: 'IFCVALVE', st: 'final', k: 'fit' }
    ]},
    { id: 'EOM', code: 'ЭОМ', lat: 'EL', name: 'Силовое электрооборудование и электроосвещение', grp: 'Инженерные системы', gost: 'ГОСТ 21.608, ГОСТ 21.613', inBld: true, def: true, el: [
      { n: 'Кабельные лотки и короба', ifc: 'IFCCABLECARRIERSEGMENT', st: 'both', k: 'seg' },
      { n: 'Щиты, шкафы', ifc: 'IFCELECTRICDISTRIBUTIONBOARD', st: 'both', k: 'equip' },
      { n: 'Светильники', ifc: 'IFCLIGHTFIXTURE', st: 'both', k: 'term' },
      { n: 'Розетки', ifc: 'IFCOUTLET', st: 'final', k: 'term' },
      { n: 'Выключатели', ifc: 'IFCSWITCHINGDEVICE', st: 'final', k: 'term' },
      { n: 'Зоны обслуживания щитов', ifc: 'IFCSPATIALZONE', st: 'both', k: 'space', ids: false }
    ]},
    { id: 'ES', code: 'ЭС', lat: 'ES', name: 'Электроснабжение', grp: 'Наружные сети', gost: '', inBld: false, def: false, el: [
      { n: 'Трансформаторные подстанции, оборудование', ifc: 'IFCTRANSFORMER', st: 'both', k: 'equip' },
      { n: 'Кабельные линии (трассы)', ifc: 'IFCCABLECARRIERSEGMENT', st: 'both', k: 'seg' },
      { n: 'Распределительные устройства', ifc: 'IFCELECTRICDISTRIBUTIONBOARD', st: 'both', k: 'equip' }
    ]},
    { id: 'SS', code: 'СС', lat: 'LAN', name: 'Сети связи', grp: 'Инженерные системы', gost: 'ГОСТ Р 21.703', inBld: true, def: false, el: [
      { n: 'Кабельные лотки и короба', ifc: 'IFCCABLECARRIERSEGMENT', st: 'both', k: 'seg' },
      { n: 'Шкафы и коммуникационное оборудование', ifc: 'IFCCOMMUNICATIONSAPPLIANCE', st: 'both', k: 'equip' },
      { n: 'Оконечные устройства', ifc: 'IFCCOMMUNICATIONSAPPLIANCE', st: 'final', k: 'term', ids: false }
    ]},
    { id: 'PS', code: 'ПС', lat: 'FA', name: 'Пожарная сигнализация и оповещение', grp: 'Инженерные системы', gost: '', inBld: true, def: false, el: [
      { n: 'Кабельные лотки и короба', ifc: 'IFCCABLECARRIERSEGMENT', st: 'both', k: 'seg' },
      { n: 'Приборы и шкафы', ifc: 'IFCCONTROLLER', st: 'both', k: 'equip' },
      { n: 'Извещатели', ifc: 'IFCSENSOR', st: 'final', k: 'term' },
      { n: 'Оповещатели', ifc: 'IFCALARM', st: 'final', k: 'term' }
    ]},
    { id: 'AK', code: 'АК', lat: 'CA', name: 'Автоматизация комплексная', grp: 'Инженерные системы', gost: 'ГОСТ 21.408', inBld: true, def: false, el: [
      { n: 'Шкафы и контроллеры', ifc: 'IFCCONTROLLER', st: 'both', k: 'equip' },
      { n: 'Датчики', ifc: 'IFCSENSOR', st: 'final', k: 'term' },
      { n: 'Кабельные лотки и короба', ifc: 'IFCCABLECARRIERSEGMENT', st: 'both', k: 'seg' }
    ]},
    { id: 'TX', code: 'ТХ', lat: 'MF', name: 'Технологические решения', grp: 'Технология', gost: 'ГОСТ 21.401', inBld: true, def: false, el: [
      { n: 'Основное технологическое оборудование (по массогабаритам)', ifc: 'IFCBUILDINGELEMENTPROXY', st: 'both', k: 'equip', note: 'класс уточняется в ПИМ' },
      { n: 'Технологические трубопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg' },
      { n: 'Мебель и лабораторное оборудование', ifc: 'IFCFURNITURE', st: 'final', k: 'equip' },
      { n: 'Зоны обслуживания и монтажа оборудования', ifc: 'IFCSPATIALZONE', st: 'both', k: 'space', ids: false },
      { n: 'Грузоподъёмное оборудование', ifc: 'IFCTRANSPORTELEMENT', st: 'both', k: 'equip' }
    ]},
    { id: 'NVK', code: 'НВК', lat: 'OWS', name: 'Наружные сети водоснабжения и канализации', grp: 'Наружные сети', gost: 'ГОСТ 21.704', inBld: false, def: false, el: [
      { n: 'Трубопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg', mat: true },
      { n: 'Колодцы, камеры', ifc: 'IFCDISTRIBUTIONCHAMBERELEMENT', st: 'both', k: 'equip' },
      { n: 'Арматура, гидранты', ifc: 'IFCVALVE', st: 'final', k: 'fit' }
    ]},
    { id: 'TS', code: 'ТС', lat: 'HMS', name: 'Тепловые сети', grp: 'Наружные сети', gost: 'ГОСТ 21.705', inBld: false, def: false, el: [
      { n: 'Трубопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg', mat: true },
      { n: 'Каналы, камеры', ifc: 'IFCDISTRIBUTIONCHAMBERELEMENT', st: 'both', k: 'equip' },
      { n: 'Изоляция', ifc: 'IFCCOVERING', pt: 'INSULATION', st: 'final', k: 'ins', mat: true },
      { n: 'Арматура, компенсаторы', ifc: 'IFCVALVE', st: 'final', k: 'fit' }
    ]},
    { id: 'GS', code: 'ГС', lat: 'GS', latNote: true, name: 'Газоснабжение', grp: 'Наружные сети', gost: 'ГОСТ 21.610', inBld: false, def: false, el: [
      { n: 'Газопроводы', ifc: 'IFCPIPESEGMENT', st: 'both', k: 'seg', mat: true },
      { n: 'Арматура, ГРП/ГРПШ', ifc: 'IFCVALVE', st: 'final', k: 'fit' }
    ]}
  ];

  /* Стандартные наборы свойств IFC4 */
  var PSET = {
    IFCWALL: 'Pset_WallCommon', IFCSLAB: 'Pset_SlabCommon', IFCCOLUMN: 'Pset_ColumnCommon', IFCBEAM: 'Pset_BeamCommon',
    IFCFOOTING: 'Pset_FootingCommon', IFCPILE: 'Pset_PileCommon', IFCDOOR: 'Pset_DoorCommon', IFCWINDOW: 'Pset_WindowCommon',
    IFCROOF: 'Pset_RoofCommon', IFCCURTAINWALL: 'Pset_CurtainWallCommon', IFCMEMBER: 'Pset_MemberCommon'
  };

  /* Цели и задачи. Задачи — по СП 333, прил. Ж (Ж.9, Ж.12). {x} — параметр показателя. */
  var GOALS = [
    { id: 'docs', on: true, goal: 'Документация, согласованная с моделью', task: 'Выпуск чертежей и спецификаций (Ж.9, п. 1)',
      metric: 'Чертежи и спецификации выпускаемых марок формируются из ЦИМ; доля листов основного комплекта, полученных из ЦИМ, — не менее {x} %', x: 80, unit: '%' },
    { id: 'coord', on: true, goal: 'Отсутствие пространственных коллизий до начала СМР', task: 'Пространственная междисциплинарная координация и выявление коллизий (Ж.9, п. 3)',
      metric: 'На дату передачи комплекта нет неустранённых коллизий категории «Критическая» по матрице коллизий (приложение А)' },
    { id: 'qty', on: true, goal: 'Достоверные объёмы работ', task: 'Подсчёт объёмов работ и оценка сметной стоимости (Ж.9, п. 4)',
      metric: 'Расхождение объёмов по ЦИМ и по спецификациям документации для позиций листа «Объёмы» приложения — не более {x} %', x: 3, unit: '%' },
    { id: 'review', on: true, goal: 'Прозрачная проверка решений Заказчиком', task: 'Проверка и оценка технических решений (Ж.9, п. 2)',
      metric: 'Заказчик просматривает ЦИМ в формате IFC без исходного ПО; все замечания и ответы ведутся в реестре замечаний' },
    { id: 'calc', on: false, goal: 'Расчёты на основе модели', task: 'Инженерно-технические расчёты (Ж.9, п. 5)',
      metric: 'Исходные данные расчётов, перечисленных в ПИМ, получены из ЦИМ; расчётные модели и ЦИМ не противоречат друг другу' },
    { id: 'pos', on: false, goal: 'Обоснованная организация строительства', task: 'Разработка ПОС и комплексного укрупнённого сетевого графика (Ж.9, п. 6)',
      metric: 'Элементы ЦИМ содержат атрибуты очереди (этапа) строительства, необходимые для увязки с графиком' },
    { id: 'ops', on: false, goal: 'Данные для эксплуатации', task: 'Планирование технического обслуживания и ремонта (Ж.12, п. 1)',
      metric: 'Оборудование в ЦИМ содержит производителя и модель; перечень оборудования выгружается из ЦИМ без ручного ввода' },
    { id: 'changes', on: true, goal: 'Актуальная модель при изменениях', task: 'Внесение изменений в документацию через ЦИМ',
      metric: 'Изменения документации, вносимые после выдачи, отражаются в ЦИМ и передаются новой версией модели не позднее {x} рабочих дней после выпуска изменения', x: 10, unit: 'раб. дн.' }
  ];

  /* Термины (определения — по СП 333 и СП 404, сокращённо) */
  var TERMS = [
    ['Информационная модель (ИМ)', 'Совокупность взаимосвязанных сведений, документов и материалов об объекте капитального строительства в электронном виде (СП 333, п. 3.1.3).'],
    ['Цифровая информационная модель (ЦИМ)', 'Электронный документ в составе ИМ, представленный в цифровом объектно-пространственном виде (СП 333, п. 3.1.6).'],
    ['Уровень проработки', 'Набор требований к полноте геометрических и атрибутивных данных элемента ЦИМ для решения задач на конкретной стадии (СП 333, п. 3.1.14).'],
    ['Коллизия', 'Дефект ЦИМ: пространственное или иное пересечение двух или более элементов (СП 333, п. 3.1.8). В настоящем документе учитываются пересечения, превышающие допуск по разделу 7.'],
    ['План реализации проекта (ПИМ, BEP)', 'Документ Исполнителя, описывающий, как выполняются настоящие требования: роли, процессы, график поставки, ПО (СП 404, п. 3.1.16).'],
    ['Среда общих данных (СОД, CDE)', 'Программно-технические средства, представляющие единый источник данных для всех участников (СП 404, п. 3.1.18).'],
    ['Ключевая точка', 'Момент передачи информации Заказчику с заранее заданным составом и критериями приёмки.'],
    ['Информационный контейнер', 'Файл или набор данных, передаваемый как единое целое (модель, том, реестр).'],
    ['График поставки информации (MIDP)', 'Сводный перечень информационных контейнеров с ответственными и сроками передачи по ключевым точкам.'],
    ['IFC', 'Открытый формат обмена данными ИМ (ISO 16739-1).'],
    ['IDS', 'Information Delivery Specification — машиночитаемый файл buildingSMART с требованиями к элементам и атрибутам IFC.'],
    ['MVD', 'Model View Definition — вид выгрузки IFC для определённого сценария обмена.'],
    ['Реестр замечаний', 'Единый документ, в котором Заказчик фиксирует замечания к ЦИМ, а Исполнитель — ответы на них.'],
    ['Протокол разногласий', 'Приложение к ПИМ с требованиями настоящего документа, которые Исполнитель предлагает изменить, и решениями Заказчика по ним.']
  ];

  var MVD = {
    RV: { name: 'Reference View', code: 'R', hint: 'для координации, просмотра и подсчёта объёмов' },
    DT: { name: 'Design Transfer View', code: 'DT', hint: 'для передачи модели в другое ПО с последующим редактированием' }
  };

  var SOFTWARE = [
    { id: 'R', name: 'Autodesk Revit', code: 'AR' },
    { id: 'RG', name: 'Renga', code: 'RG' },
    { id: 'NC', name: 'nanoCAD BIM', code: 'NK' },
    { id: 'AC', name: 'Graphisoft Archicad', code: 'GA' },
    { id: 'TK', name: 'Tekla Structures', code: 'TT' },
    { id: 'MS', name: 'Model Studio CS', code: 'MSCS' },
    { id: 'C3', name: 'Autodesk Civil 3D', code: 'AC3D' }
  ];

  var CDE_STATUS = [
    ['В работе (WIP)', 'Информация в разработке у Исполнителя; видна только его команде', 'Исполнитель'],
    ['Общий доступ (Shared)', 'Проверена Исполнителем и доступна смежникам для координации', 'Координатор Исполнителя'],
    ['Опубликовано (Published)', 'Передана Заказчику в ключевой точке; является официальной передачей', 'Управляющий ИМ Исполнителя'],
    ['Архив (Archive)', 'Заменённые и принятые версии; хранятся без изменения', 'Заказчик']
  ];

  /* RACI: функция → [Заказчик, Исполнитель (генпроектировщик), Разработчики разделов] */
  var RACI = [
    ['Разработка и актуализация требований (EIR)', 'A/R', 'C', 'I'],
    ['Назначение ключевых точек и критериев приёмки', 'A/R', 'C', 'I'],
    ['Предоставление СОД и доступа к ней', '{cdeOwnerC}', '{cdeOwnerE}', 'I'],
    ['Разработка ПИМ и графика поставки (MIDP)', 'C', 'A/R', 'C'],
    ['Согласование ПИМ и протокола разногласий', 'A/R', 'R', 'I'],
    ['Разработка ЦИМ раздела, самопроверка', 'I', 'A', 'R'],
    ['Междисциплинарная координация, проверка коллизий', 'I', 'A/R', 'C'],
    ['Публикация контейнеров в ключевой точке', 'I', 'A/R', 'C'],
    ['Проверка ЦИМ Заказчиком, ведение реестра замечаний', 'A/R', 'I', 'I'],
    ['Устранение замечаний и ответы в реестре', 'I', 'A', 'R'],
    ['Приёмка ЦИМ', 'A/R', 'C', 'I']
  ];

  var IFCNAME = {
    IFCGEOGRAPHICELEMENT: 'IfcGeographicElement',
    IFCCIVILELEMENT: 'IfcCivilElement',
    IFCWALL: 'IfcWall',
    IFCRAILING: 'IfcRailing',
    IFCFURNITURE: 'IfcFurniture',
    IFCCURTAINWALL: 'IfcCurtainWall',
    IFCDOOR: 'IfcDoor',
    IFCWINDOW: 'IfcWindow',
    IFCCOVERING: 'IfcCovering',
    IFCROOF: 'IfcRoof',
    IFCRAMP: 'IfcRamp',
    IFCSPACE: 'IfcSpace',
    IFCFOOTING: 'IfcFooting',
    IFCPILE: 'IfcPile',
    IFCSLAB: 'IfcSlab',
    IFCCOLUMN: 'IfcColumn',
    IFCBEAM: 'IfcBeam',
    IFCSTAIR: 'IfcStair',
    IFCOPENINGELEMENT: 'IfcOpeningElement',
    IFCMEMBER: 'IfcMember',
    IFCELEMENTASSEMBLY: 'IfcElementAssembly',
    IFCPLATE: 'IfcPlate',
    IFCDUCTSEGMENT: 'IfcDuctSegment',
    IFCDUCTFITTING: 'IfcDuctFitting',
    IFCAIRTERMINAL: 'IfcAirTerminal',
    IFCUNITARYEQUIPMENT: 'IfcUnitaryEquipment',
    IFCFAN: 'IfcFan',
    IFCPIPESEGMENT: 'IfcPipeSegment',
    IFCSPACEHEATER: 'IfcSpaceHeater',
    IFCVALVE: 'IfcValve',
    IFCSPATIALZONE: 'IfcSpatialZone',
    IFCPIPEFITTING: 'IfcPipeFitting',
    IFCSANITARYTERMINAL: 'IfcSanitaryTerminal',
    IFCPUMP: 'IfcPump',
    IFCTANK: 'IfcTank',
    IFCFIRESUPPRESSIONTERMINAL: 'IfcFireSuppressionTerminal',
    IFCCABLECARRIERSEGMENT: 'IfcCableCarrierSegment',
    IFCELECTRICDISTRIBUTIONBOARD: 'IfcElectricDistributionBoard',
    IFCLIGHTFIXTURE: 'IfcLightFixture',
    IFCOUTLET: 'IfcOutlet',
    IFCSWITCHINGDEVICE: 'IfcSwitchingDevice',
    IFCTRANSFORMER: 'IfcTransformer',
    IFCCOMMUNICATIONSAPPLIANCE: 'IfcCommunicationsAppliance',
    IFCCONTROLLER: 'IfcController',
    IFCSENSOR: 'IfcSensor',
    IFCALARM: 'IfcAlarm',
    IFCBUILDINGELEMENTPROXY: 'IfcBuildingElementProxy',
    IFCTRANSPORTELEMENT: 'IfcTransportElement',
    IFCDISTRIBUTIONCHAMBERELEMENT: 'IfcDistributionChamberElement'
  };
  EIR.ifcName = function (u) { return IFCNAME[u] || u; };

  EIR.DATA = { MARKS: MARKS, PSET: PSET, GOALS: GOALS, TERMS: TERMS, MVD: MVD, SOFTWARE: SOFTWARE, CDE_STATUS: CDE_STATUS, RACI: RACI };
})(typeof window !== 'undefined' ? window : globalThis);
