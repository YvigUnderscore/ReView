import React from 'react';
import { motion } from 'framer-motion';
import { MousePointer, Pencil, Square, Circle, MoveRight, Minus, Type, Eraser, Trash2, Undo, X, Send } from 'lucide-react';

const MobileDrawingToolbar = ({
    tool,
    setTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    onClose,
    onUndo,
    canUndo,
    onSave // New prop
}) => {
    // Tools suitable for mobile
    const tools = [
        { id: 'pointer', icon: MousePointer, label: 'Select' },
        { id: 'pencil', icon: Pencil, label: 'Pencil' },
        { id: 'rect', icon: Square, label: 'Rect' },
        { id: 'circle', icon: Circle, label: 'Circle' },
        { id: 'arrow', icon: MoveRight, label: 'Arrow' },
        { id: 'eraser', icon: Eraser, label: 'Eraser' },
        //{ id: 'text', icon: Type, label: 'Text' }, // Text might be tricky on mobile canvas without dedicated UI, keeping separate
    ];

    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ffffff', '#000000'];

    return (
        <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-6 left-4 right-4 z-40 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col gap-4 shadow-2xl pointer-events-auto"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
        >
            {/* Header / Actions */}
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <span className="text-white font-semibold text-sm">Annotation Tools</span>
                <div className="flex gap-2">
                    <button
                        onClick={onUndo}
                        disabled={!canUndo}
                        className={`p-2 rounded-full ${!canUndo ? 'text-white/20' : 'text-white hover:bg-white/10'}`}
                    >
                        <Undo size={20} />
                    </button>
                    <button onClick={onClose} className="p-2 bg-white/10 rounded-full text-white">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Tools Row (Scrollable) */}
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
                {tools.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTool(t.id)}
                        className={`flex flex-col items-center gap-1 min-w-[3rem] p-2 rounded-xl border transition-all ${tool === t.id
                            ? 'bg-primary border-primary text-white'
                            : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'
                            }`}
                    >
                        <t.icon size={24} />
                        <span className="text-[10px]">{t.label}</span>
                    </button>
                ))}

                {/* Send Button anchored to right of tools */}
                {onSave && (
                    <button
                        onClick={() => {
                            console.log('[MobileDrawingToolbar] Send Button Clicked');
                            onSave();
                        }}
                        className="flex flex-col items-center gap-1 min-w-[3rem] p-2 rounded-xl border border-primary bg-primary text-white hover:bg-blue-600 transition-all ml-auto"
                    >
                        <Send size={24} />
                        <span className="text-[10px] font-bold">Send</span>
                    </button>
                )}
            </div>

            {/* Properties Row */}
            <div className="flex gap-4 items-center justify-between">
                {/* Colors */}
                <div className="flex gap-2 items-center flex-1 overflow-x-auto scrollbar-none">
                    {colors.map((c) => (
                        <button
                            key={c}
                            onClick={() => setColor(c)}
                            className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent opacity-70'}`}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                    {/* Custom Color Picker wrapper could go here */}
                    <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="w-8 h-8 rounded-full overflow-hidden opacity-50 border-none p-0"
                    />
                </div>

                {/* Stroke Width */}
                <div className="flex items-center gap-2 w-1/3">
                    <div className="w-2 h-2 rounded-full bg-white opacity-50" />
                    <input
                        type="range"
                        min="2"
                        max="20"
                        value={strokeWidth}
                        onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                        className="flex-1 h-1 bg-white/20 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                    />
                    <div className="w-4 h-4 rounded-full bg-white opacity-50" />
                </div>
            </div>
        </motion.div>
    );
};

export default MobileDrawingToolbar;
