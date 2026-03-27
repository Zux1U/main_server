# Phase 7 - Roles

## Goal

Separate bots into visible responsibilities so the colony no longer feels like three identical runtimes fighting over the same planner loop.

## Implemented

- startup role assignment in `BotManager`
- first bot reserved as `builder`
- remaining bots default to `collector`
- role persisted into runtime state
- role displayed in the web panel
- autonomous wood collection limited to collectors
- `collect_wood` completion now tracks aggregate wood material units instead of raw logs only

## Why this matters

Before this pass, all bots looked broken because they were all trying to behave the same way and `collect_wood` could conflict with auto-crafting. After this pass, the behavior should be easier to reason about:

- collectors are expected to roam and gather
- builder is expected to stay available for directed build work
- panel state now shows which bot is supposed to do what

## Remaining work

- live validation on the local server
- explicit role commands from the web panel
- richer collector goals beyond wood
