import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "olm.sketch.preview",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "Whiteboard") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const result = onNodeCreated?.apply(this, arguments);
                
                this.size = [550, 750];
                this.serialize_widgets = true;

                // Create internal drawing canvas
                this.drawingCanvas = document.createElement("canvas");
                this.drawingCanvas.width = 1024;
                this.drawingCanvas.height = 1024;
                this.ctx = this.drawingCanvas.getContext("2d");
                
                // Fill with white background
                this.ctx.fillStyle = "white";
                this.ctx.fillRect(0, 0, 1024, 1024);

                // Initialize state
                this.isDrawing = false;
                this.isErasing = false;
                this.updateTimer = null;

                console.log("✅ Whiteboard initialized, canvas size:", this.drawingCanvas.width, "x", this.drawingCanvas.height);

                // Find the hidden image_data widget
                this.imageDataWidget = this.widgets.find(w => w.name === "image_data");
                if (!this.imageDataWidget) {
                    console.error("❌ image_data widget not found!");
                } else {
                    console.log("✅ image_data widget found");
                }

                // Add Clear Canvas Button
                this.addWidget("button", "Clear Canvas", null, () => {
                    this.ctx.fillStyle = "white";
                    this.ctx.fillRect(0, 0, 1024, 1024);
                    
                    // Update widget value but don't trigger inference
                    const imgData = this.drawingCanvas.toDataURL("image/png");
                    if (this.imageDataWidget) {
                        this.imageDataWidget.value = imgData;
                    }
                    
                    // Cancel any pending execution
                    if (this.updateTimer) {
                        clearTimeout(this.updateTimer);
                        this.updateTimer = null;
                    }
                    
                    this.setDirtyCanvas(true);
                    console.log("🧹 Canvas cleared - no inference");
                });

                // Paste handler
                const pasteHandler = (e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf("image") !== -1) {
                            const blob = items[i].getAsFile();
                            const img = new Image();
                            img.onload = () => {
                                this.ctx.drawImage(img, 0, 0, 1024, 1024);
                                this.setDirtyCanvas(true);
                                this.updateAndRun();
                            };
                            img.src = URL.createObjectURL(blob);
                            e.preventDefault();
                            break;
                        }
                    }
                };
                
                window.addEventListener('paste', pasteHandler);
                
                // Cleanup
                const originalOnRemoved = this.onRemoved;
                this.onRemoved = function() {
                    window.removeEventListener('paste', pasteHandler);
                    if (this.updateTimer) {
                        clearTimeout(this.updateTimer);
                    }
                    originalOnRemoved?.apply(this, arguments);
                };
                
                // Disable context menu on the canvas area
                this.onContextMenu = function(e) {
                    return false;
                };
                
                return result;
            };

            // Render canvas on node
            nodeType.prototype.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) {
                    console.log("Canvas hidden - node collapsed");
                    return;
                }
                if (!this.drawingCanvas) {
                    console.log("⚠️ No drawingCanvas found in onDrawForeground!");
                    return;
                }
                
                const canvasY = 180;
                const margin = 15;
                const bottomPadding = 25; // Space for instruction text
                const w = this.size[0] - (margin * 2);
                const h = this.size[1] - canvasY - margin - bottomPadding;

                console.log(`📐 Drawing canvas at (${margin}, ${canvasY}) with size ${w}x${h}`);

                // Draw white background
                ctx.fillStyle = "white";
                ctx.fillRect(margin, canvasY, w, h);
                
                // Draw the canvas content
                ctx.drawImage(this.drawingCanvas, margin, canvasY, w, h);
                
                // Draw border
                ctx.strokeStyle = "#444";
                ctx.strokeRect(margin, canvasY, w, h);
                
                // Draw instruction text below the canvas
                ctx.fillStyle = "white";
                ctx.font = "11px sans-serif";
                ctx.textAlign = "center";
                const textY = canvasY + h + 16; // 16px below canvas
                ctx.fillText("Click to draw • Shift+Click to erase", this.size[0] / 2, textY);
            };

            // Mouse down - start drawing
            nodeType.prototype.onMouseDown = function (e, pos, canvas) {
                if (pos[1] <= 180) return false; // Click is on widgets, not canvas
                
                // Abort any running inference
                if (this.updateTimer) {
                    clearTimeout(this.updateTimer);
                    this.updateTimer = null;
                }
                
                fetch("/interrupt", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                }).then(() => {
                    console.log("⏹️ Aborted running inference");
                }).catch(() => {
                    // No inference running
                });
                
                // Start drawing - Shift+Left Click = erase (white), Left Click = draw (black)
                this.isDrawing = true;
                this.isErasing = e.shiftKey;
                
                console.log(this.isErasing ? "🧹 Erasing mode (SHIFT+CLICK)" : "✏️ Drawing mode (CLICK)");
                
                this.ctx.beginPath();
                
                const x = (pos[0] - 15) * (1024 / (this.size[0] - 30));
                const y = (pos[1] - 180) * (1024 / (this.size[1] - 195));
                this.ctx.moveTo(x, y);
                
                return true;
            };

            // Mouse move - draw line
            nodeType.prototype.onMouseMove = function (e, pos) {
                if (!this.isDrawing) return;

                const x = (pos[0] - 15) * (1024 / (this.size[0] - 30));
                const y = (pos[1] - 180) * (1024 / (this.size[1] - 195));

                // Get brush size
                const brushWidget = this.widgets.find(w => w.name === "brush_size");
                const brushSize = brushWidget ? brushWidget.value : 10;
                
                // Set brush properties
                this.ctx.lineWidth = brushSize;
                this.ctx.lineCap = "round";
                this.ctx.lineJoin = "round";
                this.ctx.globalCompositeOperation = 'source-over';
                
                // White for eraser, black for drawing
                if (this.isErasing) {
                    this.ctx.strokeStyle = "#FFFFFF";
                } else {
                    this.ctx.strokeStyle = "#000000";
                }
                
                this.ctx.lineTo(x, y);
                this.ctx.stroke();
                
                this.setDirtyCanvas(true);
            };

            // Mouse up - finish drawing
            nodeType.prototype.onMouseUp = function () {
                if (!this.isDrawing) return;
                
                const wasErasing = this.isErasing;
                this.isDrawing = false;
                this.isErasing = false;
                
                // Update widget value
                const imgData = this.drawingCanvas.toDataURL("image/png");
                if (this.imageDataWidget) {
                    this.imageDataWidget.value = imgData;
                }
                
                // Only trigger inference for drawing, not erasing
                if (!wasErasing) {
                    this.updateAndRun();
                } else {
                    console.log("✏️ Erased - no inference");
                }
            };

            // Update and run with debounce
            nodeType.prototype.updateAndRun = function () {
                // Get debounce value
                const debounceWidget = this.widgets.find(w => w.name === "debounce_ms");
                const debounceMs = debounceWidget ? debounceWidget.value : 500;

                // Clear existing timer
                if (this.updateTimer) {
                    clearTimeout(this.updateTimer);
                    this.updateTimer = null;
                }

                // Update display
                if (this.graph) {
                    this.graph.setDirtyCanvas(true, true);
                }

                // Execute with or without debounce
                if (debounceMs === 0) {
                    this.executePrompt();
                } else {
                    console.log(`⏱️ Debouncing for ${debounceMs}ms...`);
                    this.updateTimer = setTimeout(() => {
                        this.executePrompt();
                        this.updateTimer = null;
                    }, debounceMs);
                }
            };

            // Execute the prompt
            nodeType.prototype.executePrompt = function () {
                if (!this.imageDataWidget) {
                    console.error("❌ Cannot execute - no image data widget");
                    return;
                }
                
                console.log("🚀 Executing prompt, image data length:", this.imageDataWidget.value.length);
                app.queuePrompt(0, 1);
            };
        }
    }
});