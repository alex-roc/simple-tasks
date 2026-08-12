import type { Translations } from './en.ts';

/**
 * Spanish strings. Typed as a partial dictionary on purpose: a key missing here
 * falls back to English rather than showing a raw key, so a half-finished
 * translation is never worse than no translation.
 */
const es: Partial<Translations> = {
	/* ------------------------------------------------------------------ common */
	'common.today': 'Hoy',
	'common.tomorrow': 'Mañana',
	'common.cancel': 'Cancelar',
	'common.save': 'Guardar',
	'common.dayCount_one': '{count} día',
	'common.dayCount_other': '{count} días',
	'common.activeDayCount_one': '{count} día activo',
	'common.activeDayCount_other': '{count} días activos',

	/* ---------------------------------------------------------------- commands */
	'command.openHeatmap': 'Abrir el mapa de calor',
	'command.openAgenda': 'Abrir la agenda',
	'command.agendaToday': 'Abrir la agenda de hoy',
	'command.cycleStatus': 'Cambiar el estado de la tarea',
	'command.taskActions': 'Mostrar las acciones de la tarea',
	'command.moveToTomorrow': 'Mover la tarea al día siguiente',
	'command.setDueDate': 'Poner la fecha límite de la tarea',
	'command.showInCalendar': 'Mostrar las tareas en el calendario',
	'ribbon.heatmap': 'Abrir el mapa de calor de tareas',
	'ribbon.agenda': 'Abrir la agenda de tareas',

	/* ------------------------------------------------------------------- views */
	'view.heatmap.title': 'Mapa de calor de tareas',
	'view.agenda.title': 'Agenda de tareas',

	/* ----------------------------------------------------------------- heatmap */
	'heatmap.gridLabel': 'Tareas completadas por día',
	'heatmap.empty': 'Todavía no hay días que mostrar.',
	'heatmap.less': 'Menos',
	'heatmap.more': 'Más',
	'heatmap.dayEmpty': 'Nada completado el {date}',
	'heatmap.dayCount_one': '{count} tarea completada el {date}',
	'heatmap.dayCount_other': '{count} tareas completadas el {date}',
	'heatmap.dayElsewhere_one': '{count} de ellas cerrada en otra nota',
	'heatmap.dayElsewhere_other': '{count} de ellas cerradas en otras notas',

	/* ---------------------------------------------------------------- calendar */
	'calendar.sourceName': 'Simple Tasks',
	'calendar.completedCount_one': '{count} tarea completada',
	'calendar.completedCount_other': '{count} tareas completadas',
	'calendar.openCount_one': '{count} tarea pendiente',
	'calendar.openCount_other': '{count} tareas pendientes',
	'calendar.elsewhereCount_one': '{count} de ellas cerrada en otra nota',
	'calendar.elsewhereCount_other': '{count} de ellas cerradas en otras notas',
	'calendar.menu.showDay': 'Ver las tareas de este día',
	'calendar.menu.showPeriod': 'Ver las tareas del {date}',
	'calendar.missing.title': 'Calendar Plus no está instalado',
	'calendar.missing.body':
		'Simple Tasks puede mostrar sus tareas en el calendario de Calendar Plus, aceptar tareas arrastradas desde la agenda hasta un día y añadir una entrada al menú contextual de cada día. Para eso hace falta el plugin Calendar Plus.',
	'calendar.missing.note':
		'Todo lo demás sigue funcionando sin él: el mapa de calor, la agenda, las estadísticas y las acciones sobre las tareas.',
	'calendar.missing.install': 'Instalar Calendar Plus',
	'calendar.nothingToShow':
		'Todavía ninguna tarea tiene fecha, así que el calendario no tiene nada que mostrar.',

	/* ------------------------------------------------------------------- stats */
	'stats.level': 'Nivel {count}',
	'stats.xpProgress': '{current} de {total} XP para el nivel {next}',
	'stats.xpSummary': '{xp} XP · faltan {remaining}',
	'stats.today': 'Hoy',
	'stats.thisWeek': 'Esta semana',
	'stats.currentStreak': 'Racha actual',
	'stats.bestStreak': 'Mejor racha',
	'stats.thisMonth': 'Este mes',
	'stats.perActiveDay': 'Por día activo',
	'stats.completedOver': '{count} completadas en {days}.',
	'stats.busiestDay': 'Día más cargado: {date}, con {count}.',
	'stats.topTags': 'Etiquetas principales',

	/* ------------------------------------------------------------------ agenda */
	'agenda.previousDay': 'Día anterior',
	'agenda.nextDay': 'Día siguiente',
	'agenda.goToToday': 'Ir a hoy',
	'agenda.pickDay': 'Elegir un día',
	'agenda.openDailyNote': 'Abrir la nota diaria',
	'agenda.groupBy': 'Agrupar por',
	'agenda.groupBy.note': 'Nota',
	'agenda.groupBy.project': 'Proyecto',
	'agenda.groupBy.tag': 'Etiqueta',
	'agenda.groupBy.status': 'Estado',
	'agenda.groupBy.none': 'Nada',
	'agenda.hideCompleted': 'Ocultar las completadas',
	'agenda.showCompleted': 'Mostrar las completadas',
	'agenda.empty': 'No hay nada previsto para este día.',
	'agenda.untagged': 'Sin etiqueta',
	'agenda.noProject': 'Sin proyecto',
	'agenda.summary': '{open} abiertas de {total}',
	'agenda.groupProgress': '{completed} completadas de {total}',
	'agenda.detailCount_one': '{count} detalle',
	'agenda.detailCount_other': '{count} detalles',
	'agenda.selectedCount_one': '{count} seleccionada',
	'agenda.selectedCount_other': '{count} seleccionadas',
	'agenda.taskActions': 'Acciones de {task}',
	'agenda.setStatus': 'Cambiar el estado de {task}',
	'agenda.openNote': 'Abrir la nota {note}',

	/* ------------------------------------------------------------------- bases */
	'bases.viewName': 'Tareas',
	'bases.showCompleted': 'Mostrar las tareas completadas',
	'bases.maxDepth': 'Profundidad del esquema',
	'bases.empty': 'No hay tareas en las notas que selecciona esta base.',
	'bases.noteCount_one': '{count} nota',
	'bases.noteCount_other': '{count} notas',

	/* --------------------------------------------------------------------- cli */
	'cli.stats.desc': 'Mostrar conteos de tareas, rachas y nivel',
	'cli.today.desc': 'Mostrar las tareas de un día',
	'cli.move.desc': 'Mover una tarea a una fecha o a una nota',
	'cli.flag.format': 'Formato de salida, json o text. Por defecto, text',
	'cli.flag.date': 'Día a mostrar, en formato YYYY-MM-DD. Por defecto, hoy',
	'cli.flag.tag': 'Conservar solo las tareas con esta etiqueta',
	'cli.flag.wide': 'Leer también las notas de semana, mes, trimestre, semestre y año',
	'cli.flag.open': 'Dejar fuera las tareas completadas',
	'cli.flag.task': 'Tarea a mover, como path:line con la línea empezando en 1',
	'cli.flag.toDate': 'Día de destino, en formato YYYY-MM-DD',
	'cli.flag.toNote': 'Nota de destino, como ruta relativa al vault',
	'cli.flag.heading': 'Encabezado de la nota de destino bajo el que archivarla',
	'cli.flag.granularity': 'Nota periódica a la que se refiere la fecha. Por defecto, day',
	'cli.stats.tasks': '{total} tareas en {notes} notas, {open} abiertas',
	'cli.stats.completed':
		'Completadas: {today} hoy, {week} esta semana, {month} este mes, {total} en total',
	'cli.stats.streak': 'Racha: {current} días ahora, {best} la mejor',
	'cli.stats.level': 'Nivel {level} · {xp} XP · {into} de {span} dentro del nivel',
	'cli.stats.activity': '{days} días activos, {average} por día activo',
	'cli.stats.busiest': 'Día más cargado: {date} con {count}',
	'cli.stats.tags': 'Etiquetas principales: {tags}',
	'cli.today.header': '{date} · {open} abiertas de {total}',
	'cli.today.empty': 'No hay nada previsto para el {date}.',
	'cli.move.done': 'Se movió «{text}» a {path}:{line} ({lines}).',
	'cli.error.date': 'La fecha {value} no es un día válido en formato YYYY-MM-DD.',
	'cli.error.taskFlag': 'Pasa la tarea a mover como task=path:line.',
	'cli.error.noTask': 'No hay ninguna tarea indexada en {task}.',
	'cli.error.destination': 'Pasa un destino, date= o note=.',
	'cli.error.twoDestinations': 'Pasa date= o note=, pero no los dos.',
	'cli.error.moveFailed': 'No se pudo completar el movimiento.',

	/* ----------------------------------------------------------------- popover */
	'popover.label': 'Acciones de la tarea',
	'popover.status': 'Estado',
	'popover.priority': 'Prioridad',
	'popover.moveTo': 'Mover a',
	'popover.due': 'Fecha límite',
	'popover.tags': 'Etiquetas',
	'popover.setStatus': 'Poner el estado en {name}',
	'popover.setPriority': 'Poner la prioridad en {name}',
	'popover.clearPriority': 'Quitar la prioridad',
	'popover.moveToToday': 'Mover a hoy ({date})',
	'popover.moveToTomorrow': 'Mover al día siguiente al de la tarea ({date})',
	'popover.moveToDate': 'Mover a otra fecha…',
	'popover.moveToNote': 'Mover a una nota…',
	'popover.dueToday': 'Poner la fecha límite en hoy ({date})',
	'popover.dueTomorrow': 'Poner la fecha límite en mañana ({date})',
	'popover.dueDate': 'Poner otra fecha límite…',
	'popover.dueClear': 'Quitar la fecha límite',
	'popover.addTag': 'Añadir una etiqueta…',
	'popover.removeTag': 'Quitar {tag}',
	'popover.openNote': 'Abrir la nota en esta línea',
	'popover.noTags': 'Esta línea no tiene etiquetas.',
	'popover.close': 'Cerrar',
	'popover.lineActions': 'Acciones de la tarea de esta línea',

	/* ---------------------------------------------------------------- priority */
	'priority.highest': 'Máxima',
	'priority.high': 'Alta',
	'priority.medium': 'Media',
	'priority.low': 'Baja',
	'priority.lowest': 'Mínima',

	/* ------------------------------------------------------------------ modals */
	'modal.date.title': 'Elegir una fecha',
	'modal.date.label': 'Fecha',
	'modal.note.title': 'Mover a una nota',
	'modal.note.placeholder': 'Escribe el nombre de una nota…',
	'modal.heading.title': 'Mover bajo un encabezado',
	'modal.heading.placeholder': 'Escribe o elige un encabezado…',
	'modal.heading.endOfNote': 'Al final de la nota',
	'modal.heading.create': 'Crear el encabezado «{heading}»',
	'modal.tag.title': 'Añadir una etiqueta',
	'modal.tag.placeholder': 'Escribe una etiqueta…',
	'modal.tag.create': 'Añadir la etiqueta nueva {tag}',
	'modal.tag.usage_one': '{count} tarea',
	'modal.tag.usage_other': '{count} tareas',

	/* ----------------------------------------------------------------- actions */
	'action.notFound': 'Esa tarea ya no está en esa línea; puede que la nota haya cambiado.',
	'action.noFile': 'No se pudo abrir la nota {path}.',
	'action.notPeriodic': 'Las notas de ese periodo no están configuradas en esta bóveda.',
	'action.moved': 'Se movieron {count} a {path}.',
	'action.movedLines_one': '{count} línea',
	'action.movedLines_other': '{count} líneas',
	'action.movedTasks': 'Se movieron {count} a {path}.',
	'action.taskCount_one': '{count} tarea',
	'action.taskCount_other': '{count} tareas',
	'action.movedSkipped': '{count} se quedaron donde estaban.',
	'action.movedNone': 'No se pudo mover ninguna de las tareas seleccionadas.',
	'action.moveFailed': 'No se pudo completar el movimiento, así que la nota quedó intacta.',
	'action.sameDestination': 'La tarea ya está ahí.',

	/* ---------------------------------------------------------------- settings */
	'settings.statuses.name': 'Estados',
	'settings.statuses.desc':
		'Los caracteres que este plugin entiende entre los corchetes. «Cuenta como completada» gobierna las estadísticas y el mapa de calor; «siguiente» es a dónde lleva un clic.',
	'settings.statuses.blank': '[ ] (espacio)',
	'settings.statuses.namePlaceholder': 'Nombre',
	'settings.statuses.nextPlaceholder': 'Siguiente',
	'settings.statuses.completedTooltip': 'Cuenta como completada',
	'settings.statuses.remove': 'Quitar el estado',
	'settings.statuses.add': 'Añadir un estado',
	'settings.statuses.restore': 'Restaurar los valores por defecto',
	'settings.statuses.newName': 'Estado nuevo',
	'settings.writing.name': 'Escritura',
	'settings.writing.desc':
		'La lectura siempre acepta los dos dialectos; esto solo afecta a lo que se escribe.',
	'settings.syntax.name': 'Sintaxis de los metadatos',
	'settings.syntax.desc':
		'Cómo se escriben la prioridad y las fechas en una línea: como emoji (⏫ 📅 2026-01-01) o como campos en línea ([priority:: high] [due:: 2026-01-01]).',
	'settings.syntax.emoji': 'Emoji',
	'settings.syntax.inlineField': 'Campos en línea',
	'settings.index.name': 'Índice',
	'settings.inheritTags.name': 'Heredar las etiquetas de los ítems padre',
	'settings.inheritTags.desc':
		'Una tarea lleva también las etiquetas de los ítems de lista que tiene por encima en el esquema. Las etiquetas de la nota se incluyen siempre.',
	'settings.excludeTemplates.name': 'Omitir las notas de plantilla',
	'settings.excludeTemplates.desc':
		'Dejar fuera las tareas que viven en las notas que la bóveda registra como plantillas de las notas diarias y periódicas.',
	'settings.excludedFolders.name': 'Carpetas excluidas',
	'settings.excludedFolders.desc':
		'Una carpeta por línea, relativa a la bóveda. Sus notas no se indexan nunca.',
	'settings.excludedFolders.placeholder': 'Archivo/2019',
	'settings.actions.name': 'Acciones',
	'settings.actions.desc':
		'Lo que hacen el popover y la agenda cuando escriben una línea.',
	'settings.moveHeading.name': 'Encabezado de las tareas movidas',
	'settings.moveHeading.desc':
		'Cuando una tarea se mueve a una nota o a una fecha, se coloca bajo este encabezado, que se crea si no existe. Déjalo vacío para añadirla al final de la nota.',
	'settings.moveHeading.placeholder': 'Tareas',
	'settings.dueField.name': 'Campo de fecha al reprogramar',
	'settings.dueField.desc': 'Qué fecha escribe el popover cuando eliges una nueva.',
	'settings.dueField.due': 'Límite',
	'settings.dueField.scheduled': 'Prevista',
	'settings.dueField.start': 'Inicio',
	'settings.hoverPopover.name': 'Popover al pasar el ratón en el editor',
	'settings.hoverPopover.desc':
		'Mostrar las acciones de la tarea cuando el puntero se detiene sobre una línea de tarea en una nota. Desactívalo para usar solo el comando.',
	'settings.heatmap.name': 'Vista de mapa de calor',
	'settings.heatmap.desc':
		'Lo que esa vista muestra junto a la rejilla del calendario. Todo esto viene desactivado salvo el nivel, así que la vista se abre como mapa de calor y nada más.',
	'settings.heatmapLevel.name': 'Nivel y experiencia',
	'settings.heatmapLevel.desc':
		'El nivel alcanzado, su barra de progreso y la experiencia que falta para el siguiente.',
	'settings.heatmapTiles.name': 'Tarjetas de rachas',
	'settings.heatmapTiles.desc':
		'Seis tarjetas: hoy, esta semana, la racha actual y la mejor, este mes y la media por día activo.',
	'settings.heatmapSummary.name': 'Resumen',
	'settings.heatmapSummary.desc':
		'Cuánto se completó en cuántos días activos, y cuál fue el día más cargado.',
	'settings.heatmapTopTags.name': 'Etiquetas principales',
	'settings.heatmapTopTags.desc': 'Las etiquetas con más tareas completadas.',
	'settings.periodic.name': 'Notas semestrales',
	'settings.periodic.desc':
		'Las notas diarias, semanales, mensuales, trimestrales y anuales se leen de la configuración de la bóveda. Los semestres no tienen esa configuración, así que se definen aquí.',
	'settings.semesterFolder.name': 'Carpeta',
	'settings.semesterFolder.desc':
		'Déjalo vacío para deducirla de la carpeta que comparten las demás notas periódicas.',
	'settings.semesterFormat.name': 'Formato del nombre de archivo',
	'settings.semesterFormat.desc':
		'Un formato de moment en el que la letra s representa el semestre, 1 o 2.',
	'settings.calendar.name': 'Calendar Plus',
	'settings.calendar.desc':
		'Una integración opcional. Cuando ese plugin está presente, su calendario muestra las tareas de cada periodo y acepta tareas arrastradas hasta un día.',
	'settings.calendar.status': 'Estado',
	'settings.calendar.connected': 'Conectado: el calendario está mostrando tus tareas.',
	'settings.calendar.missing':
		'No está instalado. Todo lo demás de Simple Tasks funciona sin él.',
	'settings.calendarDisplay.name': 'Cómo muestra el calendario las tareas',
	'settings.calendarDisplay.desc':
		'La intensidad de fondo sombrea cada día según cuánto completaste en él, sin gastar espacio de la celda. Los puntos marcan las completadas y las pendientes como hacía el Calendar original. En ambos casos, al pasar el ratón por un día salen las dos cifras.',
	'settings.calendarDisplay.intensity': 'Intensidad de fondo',
	'settings.calendarDisplay.dots': 'Puntos',
};

export default es;
