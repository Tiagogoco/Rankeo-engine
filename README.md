# Rankeo Engine

Motores de torneos, horarios y ligas de pádel escritos en TypeScript. Extraídos
de una aplicación de gestión deportiva para poder ejecutarlos y probarlos sin
interfaz, servidor ni base de datos.

La biblioteca recibe equipos, resultados y disponibilidad; devuelve partidos,
clasificaciones, movimientos de nivel o asignaciones de cancha. No tiene
dependencias de ejecución. TypeScript y Vitest se usan para desarrollo.

## Qué incluye

| Módulo | Funciones principales |
| --- | --- |
| Torneos | Eliminación sencilla, pases automáticos, todos contra todos, grupos y playoffs |
| Clasificación | Puntos y desempates por enfrentamientos, sets y games |
| Horarios | Asignación de canchas, descanso de jugadores, dependencias y reservas existentes |
| Ligas | Parejas rotativas, ascensos, descensos, empates, penalizaciones y ranking de temporada |
| Validación de cambios | Comprobación de movimientos e intercambios manuales de horarios |

La doble eliminación no forma parte de esta versión. Tampoco se incluyen
persistencia, autenticación, cobros ni pantallas de administración.

## Ejecutar

Requiere Node.js 20.19 o posterior y npm.

```sh
git clone git@github.com:Tiagogoco/Rankeo-engine.git
cd Rankeo-engine
npm ci
npm run check
```

| Comando | Resultado |
| --- | --- |
| `npm run check` | Revisa tipos, ejecuta todas las pruebas y compila |
| `npm test` | Ejecuta la suite completa |
| `npm run test:demo` | Ejecuta 11 pruebas seleccionadas, correspondientes a 10 escenarios |
| `npm run test:watch` | Repite las pruebas al editar archivos |
| `npm run build` | Genera JavaScript ESM y declaraciones de tipos en `dist/` |

El proyecto no necesita variables de entorno ni conexión a servicios externos.

## Ejemplo: torneo de cuatro equipos y su horario

Después de compilar, este ejemplo se puede ejecutar con Node como módulo ESM:

```js
import { tournaments, scheduling } from "./dist/index.js";

const teams = [
  { id: "a", name: "Pareja A", seed: 1 },
  { id: "b", name: "Pareja B", seed: 2 },
  { id: "c", name: "Pareja C", seed: 3 },
  { id: "d", name: "Pareja D", seed: 4 },
];

const bracket = tournaments.generateBracket(teams);
const matches = bracket.map((match) => ({
  id: match.id,
  round: match.round,
  position: match.position,
  team_a_id: match.teamA?.id ?? null,
  team_b_id: match.teamB?.id ?? null,
  next_match_id: match.nextMatchId ?? null,
  format: "single_elimination",
  category_sort_order: 0,
}));
const courts = [{ id: "c1", sort_order: 1 }, { id: "c2", sort_order: 2 }];
const config = {
  match_duration: 60,
  break_between: 15,
  player_rest_minutes: 60,
  days: [{ date: "2026-11-01", start_time: "09:00", end_time: "18:00" }],
};

const result = scheduling.generateScheduleResult(
  matches, courts, config, [], {}, "optimized",
);
const validation = scheduling.validateAssignments(result.assignments, matches, config);

console.table(result.assignments.map((assignment) => ({
  match: assignment.match_id,
  court: assignment.court_id,
  starts: assignment.scheduled_at.toISOString(),
})));
console.log({ valid: validation.valid, strategy: result.strategy });
```

Las semifinales pueden comenzar a las 09:00 en canchas distintas. La final
espera hasta las 11:00: una hora de partido y una hora de descanso. Sus jugadores
aún no están definidos, por lo que el motor reserva tiempo para quienes podrían
clasificar. El nombre de la estrategia devuelta puede ser `greedy` si el intento
optimizado no mejora el resultado base.

Para registrar resultados, `tournaments.advanceSEWinner(matches, matchId,
winnerId)` devuelve un cuadro actualizado sin modificar el arreglo original.
Para grupos se usan `generateGroups`, `generateGroupMatches` y
`generatePlayoffBracket`.

## Reglas y decisiones

### Torneos y clasificación

- Eliminación sencilla completa el cuadro a una potencia de dos. Los espacios
  vacíos producen pases automáticos y los sembrados altos quedan separados.
- Todos contra todos usa el método de rotación: cada pareja de equipos se
  enfrenta una vez y ningún equipo juega dos partidos de la misma ronda.
- Los IDs de partidos de grupo incluyen el ID del grupo para evitar colisiones.
- Playoffs ubica primero a los mejores clasificados y, dentro de cada rango,
  intenta retrasar reencuentros del mismo grupo. Es una colocación voraz:
  cantidades irregulares no garantizan una separación global óptima.
- La clasificación otorga 3 puntos por victoria y 1 por empate. Cuando varios
  equipos tienen los mismos puntos, calcula una mini-tabla entre todos ellos:
  puntos, diferencia de sets y diferencia de games. Después compara diferencias
  generales, sembrado e ID. No recalcula mini-tablas de subgrupos.
- `Standing.scored` y `Standing.conceded` representan sets ganados y perdidos.
- Un ganador debe participar en el partido. Un ID de partido inexistente no
  modifica los resultados. La validación completa de marcadores deportivos
  corresponde al consumidor.

### Horarios

- `end_time` es la **última hora permitida de inicio**, no la hora de cierre de
  las canchas. Un partido puede terminar después.
- Las fechas guardan la hora local en los campos UTC de un `Date`. El motor no
  convierte zonas horarias: quien lo integra debe proporcionar todas las fechas
  con la misma convención. `getSchedulableScheduleConfig` permite excluir el
  pasado usando un `now` expresado con esa misma convención.
- `break_between` es la pausa entre usos de una cancha. `player_rest_minutes`
  es el descanso después de terminar un partido; por defecto son 90 minutos.
- `buildOccupantMap` identifica jugadores que participan con distintos equipos
  o en distintas categorías. Sin ID de jugador, la protección se limita al ID
  del equipo.
- Los participantes desconocidos heredan los posibles jugadores de sus partidos
  de origen. Esto requiere enlaces `next_match_id` completos y puede producir
  horarios más largos que cuando los ganadores ya se conocen.
- Las reservas existentes no se mueven. La duración configurada también se usa
  para calcular su ocupación; no se admiten duraciones distintas por partido.
- `greedy` toma el primer espacio válido para cada partido. `optimized` prueba
  varios órdenes con semillas fijas: prioriza asignar más partidos, terminar
  antes y reducir inicios de la cuadrícula sin utilizar. No garantiza encontrar
  el mejor horario posible.
- El resultado puede ser parcial. Se deben comparar las asignaciones con los
  partidos solicitados. `validateAssignments` comprueba las reglas, pero no
  exige que se hayan asignado todos los partidos.

### Ligas

- En individuales, cada jugador cambia de compañero durante tres sets. Los
  movimientos de nivel usan los games de la jornada; las parejas usan sets.
- Los empates triples en los extremos quedan pendientes para todos los
  involucrados, excepto cuando no existe un nivel al cual puedan moverse.
- Un empate de cuatro jugadores conserva la convención de revisar ascenso para
  las primeras dos posiciones y descenso para las últimas dos. El consumidor
  debe resolver los movimientos pendientes.
- Las penalizaciones se aplican por persona y set. El ranking acumulado y los
  movimientos de nivel son cálculos separados.
- El horario de jornada conserva el orden de niveles recibido. La clasificación
  de temporada usa la sexta jornada para determinar sus campeones.

## Por dónde leer el código

```text
src/
  index.ts                 Entradas de la biblioteca
  bracket-engine/          Partidos, grupos, playoffs y clasificación
  schedule-engine/         Fechas, dependencias, restricciones y estrategias
  league-engine/           Parejas, movimientos, estadísticas y temporadas
  schedule-grid.ts         Intervalos de la cuadrícula
  schedule-validator.ts    Movimientos e intercambios manuales
tests/
  bracket-engine/
  schedule-engine/
  league-engine/
  helpers/
```

La entrada principal exporta los espacios `tournaments`, `scheduling`, `leagues`
y `scheduleValidation`. También hay entradas de paquete independientes:
`rankeo-engine/tournaments`, `rankeo-engine/scheduling`, `rankeo-engine/leagues`
y `rankeo-engine/schedule-validation`.

En horarios, comienza por `schedule-engine/index.ts`: coordina las estrategias.
`constraints.ts` mantiene la ocupación durante la búsqueda y `validate.ts`
comprueba las asignaciones por separado. En ligas, los cálculos están divididos
por responsabilidad para poder estudiar movimientos sin recorrer estadísticas.

## Pruebas para presentar

`npm run test:demo` selecciona pruebas de la suite completa, sin duplicarlas:

1. Un cuadro de cuatro equipos llega hasta un campeón.
2. Un pase automático avanza al participante a la siguiente ronda.
3. Cada pareja de equipos se enfrenta una vez, con número impar de equipos.
4. Un equipo no juega dos veces en la misma ronda.
5. Dos partidos de una cancha respetan duración y pausa.
6. Una persona inscrita en dos categorías conserva su descanso.
7. Una final con participantes desconocidos respeta el descanso, con ambas estrategias.
8. Cambiar el orden de cuatro partidos reduce el final de las 15:00 a las 12:30.
9. Las parejas ascienden o descienden según su resultado.
10. Una penalización individual no altera los games de compañeros y oponentes.

La suite completa conserva regresiones, entradas inválidas y escenarios
reproducibles generados con semillas. Las pruebas de optimización comparan
validez, cantidad de partidos y hora de finalización con la estrategia base.
