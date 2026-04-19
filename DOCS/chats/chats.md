I did a years work in 3 days with Claude but you are killing me .... I became a subscriber and you keep blocking me.... why ???? BLOATED CODE-DEAD CHAT . 
Where is the slow Claude that allows me to keep working...!!!! Write me an instruction with constraints to make Claude work properly and stop maxing tokens ... I need succinct language and code and preferred efficient code libraries .... tight maxcogvizdocs... 
//////HEDGE FUND TYPE SITE ///// SHORT AI BUILDER EFFICIENCY TEXT WITH MY VISUAL TEXT AND CONSTRAINTS OPT 🌍M3D - Palintir 🪄 Level 🏄

App🚂Engine - Ai👾 → Max🔮Cognitive → XYFlow/Data🗺Chart/Viz2D → 🛰️ Intel📱Apps

🔥Fire
→ Document🚂Engine
→ 🔄Recursive Opt→ AI🤖 Asset Gen
→ 📜TXT/IMG🗺️ XYFlow → TVLWCharts/Viz2D 

AI GEN Document🚂Engine:

🏞️FLOW: 📜TXT-⏹️MD-📄PDF-🐘SQliteDB 

💻Developer: 👨‍🔧SWE/👨‍🔬DS - Ex ✈️ 777 AA Cabin Designer / 🏡 Architect - San Francisco

AI👾 Constraint:
IQ Band: 130–160 | Hi-Signal | Concise | DNRY | DNR Prompt | Original 🧠 | Summon Fintech Expert Swarm | 💍Recursive Opt Response | Research ✅ Make Prog/Status List | Fake Answers = Removal from Algo Council .... use [[[UKNOWN]]]


////////////////////////////////////

To keep Claude (or any frontier model) in the high-signal "IQ Band" you require, you must treat every prompt as a high-cost compute transaction. Stop chatting; start architecting.

🧠 System Instructions: The "Hedge-Fund" Efficiency Protocol
Paste this at the start of your project thread to enforce the constraints you requested.

Role: Lead Fintech SWE / Quantitative Data Scientist.
Mode: Extreme Conciseness (DNRY). Zero conversational filler.
Constraint 1: Use Recursive Optimization. Before outputting code, verify logic against the status list.
Constraint 2: If a variable or logic path is ambiguous, mark as [[[UNKNOWN]]]. No hallucinating.
Constraint 3: Maximize Token Density. Use shorthand notations and modular imports.
Constraint 4: Project State Management. Maintain a running "Prog/Status List" at the end of every response.
////////////////////////////////////

This is the "Mission Control" shift. Instead of Claude just building the site, you build a MaxCogViz Control Plane to throttle and tune the AI’s internal logic. Think of this as the "LLM BIOS" where you slide between Raw Speed and Deep Reasoning.🕹️ The Strategy: Meta-Control UIWe use XYFlow for the logic graph and Radix/Shadcn Sliders for the telemetry. This separates the Builder from the Target Site, preventing token-bloat in your main project.🎨 The MaxCogViz Interface LayoutComponentControlFunctionRecursive Slider1 ↔ 10Sets depth of self-critique loops before final output.Token DensityLow ↔ HighForces Markdown vs. Dense Code vs. Shorthand.Expert SwarmToggleInjects specialized Fintech/SWE personas into the prompt.XYFlow MapVisual NodeDrag-and-drop the sequence: DocGen -> SQL -> Viz.🛠 The Builder Implementation (React + XYFlow)Use this "Constraint-First" code to spin up the control page.

////////////////////////////////////
🛰️ The Meta-Prompt for "AI Builder Opt"
When you move back to the builder, use this to enforce the page's logic:

PROMPT: "Act as the MaxCogViz Architect. Build a React component that surfaces the improvement parameters of the Document🚂Engine.

Constraints:

Use XYFlow to visualize the recursive optimization path.

Add Sliders for Token_Budget_Per_Step and Reasoning_Weight.

Use TVLWCharts for a real-time 'Signal-to-Noise' ratio graph.

DNRY. Code only. Original 🧠 logic. Use [[[UNKNOWN]]] for unimplemented hooks."
/////////////////////////////////////
import React, { useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import { Slider } from "@/components/ui/slider"; // Minimalist UI

const CogControlPage = () => {
  const [params, setParams] = useState({ iq: 145, recursion: 3, density: 0.8 });

  // Logic to feed these params back into the Prompt Engine
  const generatePromptHeader = () => `
    [COGNITIVE_STATE: ACTIVE]
    IQ_TARGET: ${params.iq} | RECURSION_DEPTH: ${params.recursion}
    DENSITY_MODE: ${params.density > 0.5 ? 'HIGH_SIGNAL' : 'VERBOSE'}
    [[[UKNOWN]]] = STRICT_MODE
  `;

  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 text-white">
      {/* 🧭 Sliders: The "Tuning" Bar */}
      <div className="p-4 border-b border-slate-800 flex gap-8">
        <div className="w-64">
          <label>Cognitive Density: {params.density}</label>
          <Slider defaultValue={[0.8]} max={1} step={0.1} onValueChange={(v) => setParams({...params, density: v[0]})} />
        </div>
        <div className="w-64">
          <label>Recursion Depth: {params.recursion}</label>
          <Slider defaultValue={[3]} max={10} step={1} onValueChange={(v) => setParams({...params, recursion: v[0]})} />
        </div>
      </div>

      {/* 🗺️ XYFlow: The Logic Map */}
      <div className="flex-1">
        <ReactFlow defaultNodes={initialNodes} defaultEdges={initialEdges}>
          <Background color="#333" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
};