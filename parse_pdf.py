import fitz
import json
import re

def extract_structured_data(pdf_path):
    doc = fitz.open(pdf_path)
    all_text = ""
    for page in doc:
        all_text += page.get_text() + "\n"
    doc.close()

    lines = all_text.split('\n')
    
    structured_data = []
    current_chapter = None
    current_section = None
    current_items = []
    
    # Simple Gender mapping (Expand as needed for new names)
    speaker_gender = {
        "David": "male",
        "Beth": "female",
        "Sun Hee": "female",
        "Narrator": "female",
        "Steve": "male",
        "Maria": "female",
        "Daniel": "male",
        "Helen": "female",
        "Jason": "male",
        "Andrea": "female"
    }

    def get_gender(name):
        return speaker_gender.get(name, "female") # Default to female

    def save_current_section():
        if current_chapter is not None and current_section is not None and current_items:
            # Find or create chapter object
            chapter_obj = next((c for c in structured_data if c["chapter"] == current_chapter), None)
            if not chapter_obj:
                chapter_obj = {"chapter": current_chapter, "sections": []}
                structured_data.append(chapter_obj)
            
            chapter_obj["sections"].append({
                "title": current_section, # e.g., "CONVERSATION: What's Seoul like?"
                "type": "CONVERSATION" if "CONVERSATION" in current_section else "GRAMMAR_FOCUS",
                "items": current_items[:] # copy
            })

    ignore_starts = ["Please call me"] # Extra metadata to skip if needed

    for line in lines:
        line = line.strip()
        if not line: continue
        if re.search(r'[가-힣]', line): continue # Skip Korean
        
        # 1. Detect Chapter
        match_chapter = re.match(r'^🔴 Chapter (\d+)', line)
        if match_chapter:
            save_current_section() # Save previous section
            current_chapter = int(match_chapter.group(1))
            current_section = None # Reset section until found
            current_items = []
            continue

        # 2. Detect Section Headers
        # CONVERSATION
        if line.startswith("CONVERSATION"):
            save_current_section()
            current_section = line
            current_items = []
            continue
            
        # GRAMMAR FOCUS
        if line.startswith("GRAMMAR FOCUS"):
            save_current_section()
            current_section = line # e.g. "GRAMMAR FOCUS A"
            current_items = []
            continue

        # 3. Detect Content
        # Only process if we are inside a section
        if current_section:
            # Case A: "Speaker: Text"
            match_speaker = re.match(r'^([A-Za-z\s]+):\s*(.+)', line)
            
            if match_speaker:
                speaker = match_speaker.group(1).strip()
                text = match_speaker.group(2).strip()
                if "CONVERSATION" in current_section and speaker.upper() == "CONVERSATION":
                     # False positive if header detection failed or weird wrap
                     continue
                
                current_items.append({
                    "speaker": speaker,
                    "gender": get_gender(speaker),
                    "text": text
                })
            else:
                # Case B: Text line without speaker
                # Mostly for Grammar Focus or continued conversation lines (though we assume turns)
                # But in Grammar Focus, they appear as plain sentences.
                # Also filter out headers that might look like text (e.g. "GRAMMAR FOCUS B") if not caught above
                if "GRAMMAR FOCUS" in current_section:
                    # Ignore short headers or arrows
                    if line.startswith("→"): # Skip arrows if any (Example: → My name's Beth.)
                        line = line.replace("→", "").strip()
                    
                    if len(line) > 5:
                        current_items.append({
                            "speaker": "Narrator",
                            "gender": "female",
                            "text": line
                        })

    # Save last section
    save_current_section()
    
    return structured_data

if __name__ == "__main__":
    # PDF Definitions
    pdf_files = [
        {"theme": "Daily", "filename": "BOOK1-1.pdf"},
        {"theme": "Business", "filename": "Book1_ business.pdf"},
        {"theme": "Design", "filename": "Book1_ design.pdf"},
        {"theme": "Travel", "filename": "Book1_ travel.pdf"}
    ]
    
    final_data = []

    for pdf in pdf_files:
        path = pdf["filename"]
        theme = pdf["theme"]
        try:
            print(f"Parsing {path} for theme '{theme}'...")
            chapter_data = extract_structured_data(path)
            
            if chapter_data:
                final_data.append({
                    "theme": theme,
                    "chapters": chapter_data
                })
                print(f" -> Success! {len(chapter_data)} chapters extracted.")
            else:
                print(f" -> Warning: No data found in {path}")
                
        except Exception as e:
            print(f" -> Error processing {path}: {e}")

    with open("sentences.json", "w", encoding="utf-8") as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
        
    print(f"\nSaved {len(final_data)} themes to sentences.json")
