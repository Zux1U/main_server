# Phase 03: Basic Survival

## Goal

Allow a bot to sustain simple early-game behavior without constant manual control.

## Implemented scope

- periodic survival loop
- low health retreat to home
- food consumption from inventory
- collection of nearby dropped items
- search for nearby wood blocks
- crafting planks
- crafting sticks
- crafting crafting table
- crafting wooden pickaxe when possible
- chat commands to start, stop and inspect survival

## Current limitation

The local test server is currently a flat world, so tree gathering may not be testable there without changing the world type or placing resources manually.

## Validation target

On a server with accessible resources, confirm:

- bot gathers wood from the world
- bot crafts the first wooden items
- bot eats when hungry
- bot retreats when health is low
