/**
 * Exercise: Claude Model Selection
 *
 * Scenario: A support team handles thousands of tickets daily.
 * Simple questions need fast responses; complex issues need deeper analysis.
 * This exercise reinforces how to pick the right model for different tasks.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODELS, ModelKey } from "./models.js";
import { calculateCost, logStats, displayComparison, ensureParsedResponse } from "./helpers.js";
import { Message, Model } from "@anthropic-ai/sdk/resources";
import dotenv from "dotenv";
import { TICKETS } from "./sample-tickets.js";
dotenv.config();

// Initialize the Anthropic client
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});


// Helper: Call Claude and return the response with usage stats

async function callClaude(modelKey: ModelKey, system: string, userMessage: string) {
  const model = MODELS[modelKey];
  const start = Date.now();

  const rawResponse = await client.messages.create({
    model: model.id,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  // only required for Vocareum proxy to parse the response correctly
  const response = ensureParsedResponse(rawResponse as any); 

  const ms = Date.now() - start;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = calculateCost(inputTokens, outputTokens, model);
  const text = response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { text, inputTokens, outputTokens, ms, cost };
}


// Step 1: Haiku - Fast classification for simple tickets

async function testHaiku() {
  console.log(`\n---  Haiku for Simple Classification ---\n`);
  // Define system prompt
  const system = `Classify a support ticket's priority and return only the level: 
                  Valid outputs are "LOW", "MEDIUM", "HIGH", or "URGENT".`;
  // Call Claude with Haiku model
  const result = await callClaude("haiku", system, TICKETS.simple);
  // Display results
  console.log(`Result: ${result.text}`);
  logStats(result);
  console.log(`\n💡 Haiku is perfect for simple tasks - fast and cheap!`);
}


// Step 2: Sonnet - Balanced analysis for moderate tickets

async function testSonnet() {
  console.log("\n--- STEP 2: Sonnet for Detailed Analysis ---\n");

  const system = `Analyze the support ticket. Extract:
                  1. Priority level
                  2. Issue category
                  3. Key details
                  4. Recommended action
                  Be concise.`;

  const result = await callClaude("sonnet", system, TICKETS.moderate);

  console.log(`Result:\n${result.text}`);
  logStats(result);
  console.log(`\n💡 Sonnet balances quality and cost - great for most tasks!`);
}


// Step 3: Opus - Complex reasoning for multi-issue tickets

async function testOpus() {
  console.log("\n--- STEP 3: Opus for Complex Reasoning ---\n");

  const system = `You are a senior support manager. Provide:
                  1. Issue summary
                  2. Root cause hypothesis for each issue
                  3. Impact assessment (business, technical)
                  4. Prioritized action plan

                  Think through each element carefully.`;

  const result = await callClaude("opus", system, TICKETS.complex);

  console.log(`Result:\n${result.text}`);
  logStats(result);
  console.log(`\n💡 Opus excels at complex, multi-factor reasoning!`);
}


// Step 4: Compare all models on the same task

async function testCompare() {
  console.log("\n--- STEP 4: Model Comparison ---\n");

  const system = `Analyze the ticket. Provide:
                  1. Priority (low/medium/high/urgent)
                  2. Main issue
                  3. One recommended action`;

  const results = [];

  for (const key of ["haiku", "sonnet", "opus"] as ModelKey[]) {
    const r = await callClaude(key, system, TICKETS.moderate);
    results.push({ model: MODELS[key].name, ...r });
  }

  displayComparison(results);
  console.log("\n💡 Pick the right model for the job!");
}


// Main

async function main() {
  console.log("=".repeat(60));
  console.log("  EXERCISE: Claude Model Selection");
  console.log("  Scenario: Customer Support Ticket System");
  console.log("=".repeat(60));

  await testHaiku();
  await testSonnet();
  await testOpus();
  await testCompare();
}

main().catch(console.error);
