from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from skills import skill_manager

SKILLS_REGISTRY_URL = "https://raw.githubusercontent.com/santiagotoro2023/vantis/main/skills_registry.json"

router = APIRouter(prefix="/api/skills", tags=["skills"])


class SkillCreate(BaseModel):
    name: str
    description: str
    code: str
    trigger_conditions: str = ""


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    trigger_conditions: Optional[str] = None
    enabled: Optional[int] = None


class SkillExecute(BaseModel):
    args: list[str] = []


@router.get("")
async def list_skills(user: dict = Depends(get_current_user)):
    return await skill_manager.list_skills()


@router.get("/{skill_id}")
async def get_skill(skill_id: int, user: dict = Depends(get_current_user)):
    skill = await skill_manager.get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return skill


@router.post("")
async def create_skill(data: SkillCreate, user: dict = Depends(require_admin)):
    sid = await skill_manager.create_skill(
        data.name, data.description, data.code,
        data.trigger_conditions, author=user["username"],
    )
    return {"id": sid, "status": "Skill created. VANTIS has a new capability."}


@router.put("/{skill_id}")
async def update_skill(
    skill_id: int, data: SkillUpdate, user: dict = Depends(require_admin)
):
    kwargs = {k: v for k, v in data.model_dump().items() if v is not None}
    await skill_manager.update_skill(skill_id, **kwargs)
    return {"status": "Updated."}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: int, user: dict = Depends(require_admin)):
    await skill_manager.delete_skill(skill_id)
    return {"status": "Skill removed."}


@router.post("/{skill_id}/execute")
async def execute_skill(
    skill_id: int, data: SkillExecute, user: dict = Depends(require_admin)
):
    return await skill_manager.execute_skill(skill_id, data.args)


class MarketplaceInstall(BaseModel):
    skill_id: str


@router.get("/marketplace")
async def get_marketplace(user: dict = Depends(get_current_user)):
    """Fetch skill registry from GitHub."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(SKILLS_REGISTRY_URL)
            r.raise_for_status()
            registry = r.json()
        # Mark which are already installed by name
        installed_skills = await skill_manager.list_skills()
        installed_names = {s['name'] for s in installed_skills}
        for skill in registry.get('skills', []):
            skill['installed'] = skill['name'] in installed_names
        return registry
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch marketplace: {e}")


@router.post("/marketplace/install")
async def install_marketplace_skill(data: MarketplaceInstall, user: dict = Depends(require_admin)):
    """Install a skill from the marketplace registry."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(SKILLS_REGISTRY_URL)
            r.raise_for_status()
            registry = r.json()
        skill = next((s for s in registry.get('skills', []) if s['id'] == data.skill_id), None)
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found in registry.")
        # Check if already installed
        installed = await skill_manager.list_skills()
        if any(s['name'] == skill['name'] for s in installed):
            raise HTTPException(status_code=409, detail="Skill already installed.")
        sid = await skill_manager.create_skill(
            skill['name'], skill['description'], skill['code'],
            skill.get('trigger_conditions', ''), author=skill.get('author', 'marketplace'),
        )
        return {"id": sid, "status": f"Skill '{skill['name']}' installed successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Install failed: {e}")
