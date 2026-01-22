import json
import os
import glob

def generate_json():
    chapters = []
    
    # Get all Chapter*.txt files
    # Sort them to ensure order Chapter1, Chapter2, ...
    files = glob.glob("Chapter*.txt")
    # Custom sort to handle Chapter1, Chapter2, Chapter10 correctly
    files.sort(key=lambda x: int(''.join(filter(str.isdigit, x)) or 0))
    
    print(f"Found files: {files}")

    for i, filename in enumerate(files):
        try:
            print(f"Reading {filename}...")
            with open(filename, 'r', encoding='utf-8') as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
            
            print(f" - Found {len(lines)} lines")
            
            items = []
            for j, line in enumerate(lines):
                # Alternate gender for variety, default speaker names
                gender = "male" if j % 2 == 0 else "female"
                speaker = "Male" if gender == "male" else "Female"
                
                items.append({
                    "text": line,
                    "speaker": speaker,
                    "gender": gender
                })
            
            # Extract chapter number from filename (e.g., Chapter1.txt -> 1)
            chapter_num = ''.join(filter(str.isdigit, filename))
            
            chapters.append({
                "chapterId": int(chapter_num) if chapter_num else i + 1,
                "title": f"Chapter {chapter_num}",
                "items": items
            })
            
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    # Save to sentences.json
    try:
        with open('sentences.json', 'w', encoding='utf-8') as f:
            json.dump(chapters, f, ensure_ascii=False, indent=2)
        print(f"Successfully created sentences.json with {len(chapters)} chapters.")
        # Print first chapter items count for verification
        if chapters:
            print(f"First chapter has {len(chapters[0]['items'])} items.")
    except Exception as e:
        print(f"Error saving JSON: {e}")

if __name__ == "__main__":
    generate_json()
