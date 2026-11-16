import * as TE from "fp-ts/TaskEither"

import { getPreRequestScriptMethods } from "~/utils/shared"
import {
  EnvironmentVariable,
  SandboxPreRequestResult,
  TestResult,
} from "~/types"

const executeScriptInContext = (
  preRequestScript: string,
  envs: TestResult["envs"],
  scopedVariables: EnvironmentVariable[] = []
): TE.TaskEither<string, SandboxPreRequestResult> => {
  try {
    const { pw, updatedEnvs } = getPreRequestScriptMethods(
      envs,
      scopedVariables
    )

    // Create a function from the pre request script using the `Function` constructor
    const executeScript = new Function("pw", preRequestScript)

    // Execute the script
    executeScript(pw)

    return TE.right({
      updatedEnvs,
      updatedCookies: null,
    })
  } catch (error) {
    return TE.left(
      `Script execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

// Listen for messages from the main thread
self.addEventListener("message", async (event) => {
  const { preRequestScript, envs, scopedVariables } = event.data

  const results = await executeScriptInContext(
    preRequestScript,
    envs,
    scopedVariables
  )()

  // Post the result back to the main thread
  self.postMessage({ results })
})
