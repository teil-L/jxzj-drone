import re

def update_index_html():
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find the Video Placeholder Background div with huge base64 in index.html
    pattern = r'(<!-- Video Placeholder Background -->\s*<div\s*class="w-full h-full bg-\[url\(\'data:image/jpeg;base64,.*?\)\'\] bg-cover bg-center opacity-70 filter contrast-125 saturate-150">\s*</div>)'
    
    replacement = '''<!-- Video Placeholder Background -->
                    <img src="http://localhost:5000/video_feed" class="w-full h-full object-cover filter contrast-125 saturate-150 absolute inset-0 z-0" alt="Live Feed">'''
                    
    new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)

def update_analysis_html():
    with open('事后复现分析.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find the Video Placeholder img with huge base64 in 事后复现分析.html
    pattern = r'(<!-- Video Placeholder -->\s*<div class="w-full h-full bg-\[#030812\] relative overflow-hidden flex flex-col">\s*)<img src="data:image/jpeg;base64,.*?"\s*class="w-full h-full object-cover opacity-60 filter contrast-125 saturate-150 absolute inset-0">'
    
    replacement = r'\1<video src="assets/processed_video.mp4" class="w-full h-full object-cover opacity-60 filter contrast-125 saturate-150 absolute inset-0" autoplay loop muted></video>'
    
    new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    
    with open('事后复现分析.html', 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == '__main__':
    update_index_html()
    update_analysis_html()
    print("Files updated successfully.")
