from pathlib import Path
from dotenv import load_dotenv
from vision_agents.core import Agent, AgentLauncher, User, Runner
from vision_agents.plugins import getstream, gemini

base_dir = Path(__file__).resolve().parent
load_dotenv(dotenv_path=base_dir / ".env", override=False)
load_dotenv(dotenv_path=base_dir.parent / ".env", override=False)

async def create_agent(**kwargs) -> Agent:
    return Agent(
        edge=getstream.Edge(),
        agent_user=User(name="Assistant", id="agent"),
        instructions="You're a helpful voice assistant. Be concise.",
        llm=gemini.Realtime(),
    )

async def join_call(agent: Agent, call_type: str, call_id: str, **kwargs) -> None:
    call = await agent.create_call(call_type, call_id)
    async with agent.join(call):
        await agent.simple_response("Greet the user")
        await agent.finish()

if __name__ == "__main__":
    Runner(AgentLauncher(create_agent=create_agent, join_call=join_call)).cli()
