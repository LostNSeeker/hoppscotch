import { Environment, HoppRESTRequestVariable } from "@hoppscotch/data"
import { cloneDeep } from "lodash-es"

import {
  getCurrentEnvironment,
  getGlobalVariables,
  AggregateEnvironment,
  resolveEnvironmentVariableValues,
} from "~/newstore/environments"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { transformInheritedCollectionVariablesToAggregateEnv } from "./inheritedCollectionVarTransformer"

/**
 * Populate the currentValue of the environment variables and set the secret values.
 * Uses the same resolver as the editor aggregates, so the value sent with the
 * request matches what the variable hover shows.
 * @param selected
 * @param global
 * @returns
 */
const unWrapEnvironments = (
  selected: Environment,
  global: Environment["variables"]
) => ({
  global: global.map((globalVar, index) => ({
    ...globalVar,
    ...resolveEnvironmentVariableValues("Global", globalVar, index),
  })),
  selected: selected.variables.map((selectedVar, index) => ({
    ...selectedVar,
    ...resolveEnvironmentVariableValues(selected.id, selectedVar, index),
  })),
})

export const getCombinedEnvVariables = (temp?: Environment["variables"]) => {
  const reformedVars = unWrapEnvironments(
    getCurrentEnvironment(),
    getGlobalVariables()
  )
  return {
    global: cloneDeep(reformedVars.global),
    selected: cloneDeep(reformedVars.selected),
    temp: temp ? cloneDeep(temp) : [],
  }
}

// Active request variables → `AggregateEnvironment` rows; `value` populates both
// `currentValue` and `initialValue`.
export const transformRequestVariablesToAggregateEnv = (
  requestVariables: HoppRESTRequestVariable[] | undefined
): AggregateEnvironment[] =>
  (requestVariables ?? [])
    .filter((v) => v.active)
    .map((v) => ({
      key: v.key,
      currentValue: v.value,
      initialValue: v.value,
      sourceEnv: "RequestVariable",
      secret: false,
    }))

// Builds the precedence-ordered variable list for resolving `<<var>>` templates:
// request → collection → environment (highest first). Matches the runtime's
// `combineEnvVariables` ordering, so previews stay in sync with execution. Not
// de-duplicated — wrap with `filterNonEmptyEnvironmentVariables` so an empty
// higher-precedence variable falls through to a lower-precedence one. (The
// current→initial value fallback itself happens later, at resolution time in
// `getResolvedVariableValue`, invoked by `parseTemplateStringE`.)
// `showSecretCollectionValues=false` keeps inherited
// collection secrets masked (used by the inspector / autocomplete).
export const getEffectiveVariablesForRequest = (
  requestVariables: HoppRESTRequestVariable[] | undefined,
  inheritedVariables: HoppInheritedProperty["variables"] | undefined,
  environmentVars: AggregateEnvironment[],
  showSecretCollectionValues = true
): AggregateEnvironment[] => {
  const requestVars = transformRequestVariablesToAggregateEnv(requestVariables)

  const collectionVars = transformInheritedCollectionVariablesToAggregateEnv(
    inheritedVariables ?? [],
    showSecretCollectionValues
  )

  return [...requestVars, ...collectionVars, ...environmentVars]
}

/**
 * De-duplicates a precedence-ordered variable list by key, keeping the first
 * occurrence unless it has no effective value and a later one does — so an empty
 * higher-precedence variable falls through to a lower-precedence one. Values are
 * left untouched; the current→initial fallback is applied at resolution time in
 * `getResolvedVariableValue` (via `parseTemplateStringE`). Shared by the request
 * runner, the editor highlighter, and the environment inspector so all three
 * agree on precedence.
 */
export const filterNonEmptyEnvironmentVariables = <
  T extends { key: string; currentValue?: string; initialValue?: string },
>(
  envs: T[]
): T[] => {
  const hasEffectiveValue = (env: T): boolean =>
    Boolean(env.currentValue || env.initialValue)

  const envsMap = new Map<string, T>()
  envs.forEach((env) => {
    if (envsMap.has(env.key)) {
      const existingEnv = envsMap.get(env.key)
      if (
        existingEnv &&
        !hasEffectiveValue(existingEnv) &&
        hasEffectiveValue(env)
      ) {
        envsMap.set(env.key, env)
      }
    } else {
      envsMap.set(env.key, env)
    }
  })

  return Array.from(envsMap.values())
}

/**
 * Defensively normalizes possibly-legacy env rows to the v2 `AggregateEnvironment`
 * shape (preserving any extra fields), so consumers like
 * `filterNonEmptyEnvironmentVariables` / `parseTemplateStringE` always see a
 * `currentValue`/`initialValue`. Legacy rows shaped `{ key, value }` (e.g. older
 * embed callers) lack those fields and would otherwise resolve to an empty string.
 */
export const normalizeAggregateEnvs = (
  envs: ReadonlyArray<
    Partial<AggregateEnvironment> & { key: string; value?: string }
  >
): AggregateEnvironment[] =>
  envs.map((env) => ({
    ...env,
    currentValue: env.currentValue ?? env.value ?? "",
    initialValue: env.initialValue ?? env.value ?? "",
    sourceEnv: env.sourceEnv ?? "",
    secret: env.secret ?? false,
  }))
