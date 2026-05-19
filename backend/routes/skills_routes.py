from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from skills import skill_manager

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
