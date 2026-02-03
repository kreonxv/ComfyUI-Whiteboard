import torch
import numpy as np
from PIL import Image
import base64
import io

class Whiteboard:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "width": ("INT", {"default": 768, "min": 64, "max": 2048}),
                "height": ("INT", {"default": 768, "min": 64, "max": 2048}),
                "brush_size": ("INT", {"default": 20, "min": 1, "max": 100}),
                "debounce_ms": ("INT", {"default": 1500, "min": 0, "max": 5000, "step": 100}),
                "image_data": ("STRING", {"default": "", "multiline": False}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "image/drawing"
    
    def process(self, width, height, brush_size, debounce_ms, image_data=""):
        print(f"DEBUG: Received image_data length: {len(image_data)}")
        
        # Return blank white image if no data
        if not image_data or len(image_data) < 100:
            print("⚠️ No image data, returning white canvas")
            return (torch.ones((1, height, width, 3), dtype=torch.float32),)
        
        try:
            # Strip the data URL header if present
            if "," in image_data:
                image_data = image_data.split(",", 1)[1]
            
            # Decode base64
            img_bytes = base64.b64decode(image_data)
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            
            # Resize to requested dimensions
            img = img.resize((width, height), Image.Resampling.LANCZOS)
            
            # Convert to torch tensor (HWC format, normalized to 0-1)
            img_np = np.array(img).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img_np)[None,]
            
            print(f"✅ Successfully processed image: {img_tensor.shape}")
            return (img_tensor,)
            
        except Exception as e:
            print(f"❌ PYTHON ERROR: {e}")
            import traceback
            traceback.print_exc()
            return (torch.ones((1, height, width, 3), dtype=torch.float32),)

WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {"Whiteboard": Whiteboard}
NODE_DISPLAY_NAME_MAPPINGS = {"Whiteboard": "Whiteboard"}