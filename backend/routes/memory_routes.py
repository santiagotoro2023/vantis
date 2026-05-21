from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from auth import get_current_user
from memory import memory_manager
from emotions import emotion_manager

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """
    Upload a text or PDF file. Extract text and store as memories.
    Returns count of memory chunks created.
    """
    MAX_SIZE = 5 * 1024 * 1024  # 5MB
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "File too large (max 5MB).")

    filename = file.filename or "upload"
    text = ""

    if filename.lower().endswith(".pdf"):
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            text = "\n".join(p.extract_text() or "" for p in reader.pages)
        except Exception as exc:
            raise HTTPException(400, f"PDF extraction failed: {exc}")
    else:
        # Plain text / markdown / code
        try:
            text = content.decode("utf-8", errors="replace")
        except Exception:
            raise HTTPException(400, "Could not decode file as text.")

    text = text.strip()
    if not text:
        raise HTTPException(400, "File contains no extractable text.")

    # Chunk into ~800-char pieces with overlap
    chunk_size = 800
    overlap = 100
    chunks = []
    i = 0
    while i < len(text):
        chunks.append(text[i:i + chunk_size])
        i += chunk_size - overlap

    created = 0
    for chunk in chunks[:40]:  # cap at 40 chunks per upload
        chunk = chunk.strip()
        if len(chunk) < 20:
            continue
        mem_content = f"[From file: {filename}]\n{chunk}"
        await memory_manager.store_memory(
            content=mem_content,
            emotion_snapshot=emotion_manager.to_dict(),
            tags=["file_upload", filename],
            owner=user["username"],
        )
        created += 1

    return {"memories_created": created, "filename": filename, "chunks": len(chunks)}
