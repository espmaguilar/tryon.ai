import os
from pathlib import Path

from dotenv import load_dotenv
from vision_agents.core import Agent, AgentLauncher, Runner, User
from vision_agents.plugins import gemini, getstream

from nano_banana import NanoBananaProcessor


base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)


async def create_agent(**kwargs) -> Agent:
    llm = gemini.Realtime(fps=3)

    nano_processor = NanoBananaProcessor(
        api_key=os.getenv("NANO_BANANA_API_KEY"),
        model=os.getenv("NANO_BANANA_MODEL", "nano-banana-2"),
        output_dir=os.getenv("TRYON_OUTPUT_DIR", str(base_dir / "outputs")),
    )

    @llm.register_function(
        description="Set the merchandise image to try on. Input should be an image URL or local file path."
    )
    async def set_merchandise(image_path_or_url: str) -> str:
        value = await nano_processor.set_merchandise(image_path_or_url)
        return f"Merchandise set to: {value}"

    @llm.register_function(
        description="Generate a virtual try-on result using the latest camera frame and selected merchandise."
    )
    async def try_on_current_item() -> str:
        result = await nano_processor.generate_tryon()
        await nano_processor.emit_result(result)
        return (
            f"Try-on status: {result.get('status')}, "
            f"job_id: {result.get('job_id')}, "
            f"image_url: {result.get('image_url')}"
        )

    @llm.register_function(description="Clear the currently selected merchandise image.")
    async def clear_merchandise() -> str:
        await nano_processor.clear_merchandise()
        return "Merchandise cleared."

    return Agent(
        edge=getstream.Edge(),
        agent_user=User(name="Assistant", id="agent"),
        instructions=(
            "You are a virtual mirror assistant. Help the user try on merchandise. "
            "Use set_merchandise to choose an item, then use try_on_current_item to generate "
            "a mirror result from the latest camera frame."
        ),
        llm=llm,
        processors=[nano_processor],
    )


async def join_call(agent: Agent, call_type: str, call_id: str, **kwargs) -> None:
    call = await agent.create_call(call_type, call_id)

    for processor in getattr(agent, "processors", []):
        if hasattr(processor, "attach_call"):
            processor.attach_call(call)

    async with agent.join(call):
        await agent.simple_response(
            "Hi! I can help with virtual try-on. Tell me the merchandise image URL, then ask me to generate the try-on."
        )
        await agent.finish()


if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
