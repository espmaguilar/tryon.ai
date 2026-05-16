from dotenv import load_dotenv
import os
from vision_agents.core import Agent, AgentLauncher, User, Runner
from vision_agents.plugins import getstream, gemini, ultralytics

load_dotenv()


async def create_agent(**kwargs) -> Agent:
    llm = gemini.Realtime(fps=3)

    processors = [
        ultralytics.YOLOPoseProcessor(model_path="yolo26n-pose.pt")
    ]

    # Optional: initialize Decart restyling processor if DECART_API_KEY is provided
    decart_api_key = os.getenv("DECART_API_KEY")
    restyling_processor = None
    if decart_api_key:
        try:
            from vision_agents.plugins import decart

            restyling_processor = decart.RestylingProcessor(
                model="lucy_2_rt",
                initial_prompt="Studio Ghibli animation style",
                api_key=decart_api_key,
                mirror=True,
                width=1280,
                height=720,
            )
            processors.append(restyling_processor)

            # Register a function on the LLM that allows runtime style updates
            @llm.register_function(description="Changes the video style")
            async def change_style(prompt: str) -> str:
                await restyling_processor.update_prompt(prompt)
                return f"Style changed to: {prompt}"

        except Exception as e:
            print("Decart plugin not available or failed to initialize:", e)

    return Agent(
        edge=getstream.Edge(),
        agent_user=User(name="Coach", id="agent"),
        instructions="Analyze what you see on camera and provide real-time feedback on the user's form and technique.",
        llm=llm,
        processors=processors,
    )

async def join_call(agent: Agent, call_type: str, call_id: str, **kwargs) -> None:
    call = await agent.create_call(call_type, call_id)
    async with agent.join(call):
        await agent.simple_response("Greet the user and let them know you can see them")
        await agent.finish()

if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
