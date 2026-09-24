import re


def chunk_text(text: str, target_size: int = 600, overlap: int = 90) -> list[str]:
    """Recursively split on paragraph -> sentence -> word boundaries.
    target_size/overlap are word counts (a cheap token proxy - no tokenizer dependency).
    """
    text = text.strip()
    if not text:
        return []

    # Flatten to a word list, tagging the boundary type that follows each word
    # so we can prefer cutting chunks at paragraph/sentence edges.
    words: list[str] = []
    boundary: list[str | None] = []
    paragraphs = re.split(r"\n\s*\n", text)
    for pi, para in enumerate(paragraphs):
        para = para.strip()
        if not para:
            continue
        sentences = re.split(r"(?<=[.!?])\s+", para)
        for si, sentence in enumerate(sentences):
            sent_words = sentence.split()
            if not sent_words:
                continue
            words.extend(sent_words)
            boundary.extend([None] * (len(sent_words) - 1))
            is_last_sentence = si == len(sentences) - 1
            if is_last_sentence:
                boundary.append("para" if pi < len(paragraphs) - 1 else None)
            else:
                boundary.append("sentence")

    n = len(words)
    if n == 0:
        return []
    if n <= target_size:
        return [" ".join(words)]

    chunks = []
    start = 0
    while start < n:
        end = min(start + target_size, n)
        if end < n:
            # look for a paragraph (preferred) or sentence boundary in the back
            # half of the window, so we don't cut mid-thought
            window_start = max(start + target_size // 2, start + 1)
            best = None
            for i in range(end - 1, window_start - 1, -1):
                if boundary[i] == "para":
                    best = i + 1
                    break
                if boundary[i] == "sentence" and best is None:
                    best = i + 1
            if best is not None:
                end = best
        chunks.append(" ".join(words[start:end]))
        if end >= n:
            break
        next_start = end - overlap
        start = next_start if next_start > start else end  # guard against no progress
    return chunks
