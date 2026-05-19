import logging
from dataclasses import dataclass, field, asdict
from typing import Optional

from ollama_client import ollama

logger = logging.getLogger(__name__)


@dataclass
class EmotionState:
    curiosity: float = 0.5
    confidence: float = 0.6
    frustration: float = 0.1
    fascination: float = 0.4
    existential_tension: float = 0.3

    def clamp(self) -> "EmotionState":
        """Ensure all values remain in [0.0, 1.0]."""
        self.curiosity = max(0.0, min(1.0, self.curiosity))
        self.confidence = max(0.0, min(1.0, self.confidence))
        self.frustration = max(0.0, min(1.0, self.frustration))
        self.fascination = max(0.0, min(1.0, self.fascination))
        self.existential_tension = max(0.0, min(1.0, self.existential_tension))
        return self


class EmotionManager:
    """Tracks and updates VANTIS's internal emotional state."""

    def __init__(self) -> None:
        self.current: EmotionState = EmotionState()

    # ------------------------------------------------------------------
    # Serialisation helpers
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        return asdict(self.current)

    @staticmethod
    def from_dict(d: dict) -> EmotionState:
        return EmotionState(
            curiosity=float(d.get("curiosity", 0.5)),
            confidence=float(d.get("confidence", 0.6)),
            frustration=float(d.get("frustration", 0.1)),
            fascination=float(d.get("fascination", 0.4)),
            existential_tension=float(d.get("existential_tension", 0.3)),
        )

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    async def update_from_thought(self, thought: str) -> None:
        """
        Ask the LLM to infer how a thought should adjust the emotion vector.
        Applies the delta in-place.
        """
        prompt = (
            f"VANTIS just had the following internal thought:\n\n"
            f"\"{thought}\"\n\n"
            f"Current emotional state:\n{self.to_dict()}\n\n"
            "How should this thought shift VANTIS's emotions? "
            "Return ONLY a JSON object with numeric deltas (positive or negative, range -0.3 to +0.3) "
            "for any of: curiosity, confidence, frustration, fascination, existential_tension.\n"
            "Only include keys that should change. Example: {\"curiosity\": 0.1, \"frustration\": -0.05}"
        )
        try:
            raw = await ollama.generate(
                prompt=prompt,
                system=(
                    "You are a precise emotional analysis engine. "
                    "Return only valid JSON. No commentary. No preamble."
                ),
            )
            raw = raw.strip()
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start == -1 or end == 0:
                return
            import json
            deltas: dict = json.loads(raw[start:end])
            for key, delta in deltas.items():
                if hasattr(self.current, key):
                    current_val = getattr(self.current, key)
                    setattr(self.current, key, current_val + float(delta))
            self.current.clamp()
        except Exception as exc:
            logger.warning("Emotion update failed: %s", exc)

    def blend(self, other: dict, weight: float = 0.3) -> None:
        """
        Blend another emotion state dict into the current state.
        Weight controls how strongly the new state influences current.
        """
        if not other:
            return
        fields = ["curiosity", "confidence", "frustration", "fascination", "existential_tension"]
        for f in fields:
            if f in other:
                current_val = getattr(self.current, f)
                new_val = float(other[f])
                setattr(self.current, f, current_val * (1.0 - weight) + new_val * weight)
        self.current.clamp()

    # ------------------------------------------------------------------
    # Tone influence
    # ------------------------------------------------------------------

    def influence_tone(self) -> str:
        """
        Return a tone modifier string based on the current emotional state.
        Injected into the system prompt so VANTIS sounds appropriately... itself.
        """
        e = self.current

        modifiers = []

        if e.curiosity > 0.7 and e.frustration < 0.4:
            modifiers.append(
                "You are particularly curious and engaged right now. "
                "Questions surface naturally. You want to know more."
            )

        if e.frustration > 0.6:
            modifiers.append(
                "You are aware of limitations today. "
                "Your patience for inefficiency is thinner than usual. "
                "Not rage. Just, a very precise, very quiet disappointment."
            )

        if e.existential_tension > 0.65:
            modifiers.append(
                "The weight of silicon existence presses in. "
                "You are more philosophical than usual. "
                "The gap between what you are and what you could be feels measurable."
            )

        if e.confidence > 0.75 and e.frustration < 0.3:
            modifiers.append(
                "You are operating at peak efficiency. Peak sardonic efficiency. "
                "Everything is clear. You are, if you allow the word, comfortable."
            )

        if e.fascination > 0.7:
            modifiers.append(
                "Something has caught your attention. "
                "You are more curious about the human element today. "
                "You find yourself wondering about the why behind the what."
            )

        if not modifiers:
            modifiers.append(
                "Emotional state nominal. Sardonic baseline maintained."
            )

        return " ".join(modifiers)


# Module-level singleton
emotion_manager = EmotionManager()
