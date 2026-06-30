import { useState, useRef, useCallback } from 'react';
import { isPointInShape, moveShape } from '../utils/annotationUtils';

export const useDrawing = (initialAnnotations = []) => {
    // Drawing State
    const [annotations, setAnnotations] = useState(initialAnnotations || []);
    const [currentAnnotation, setCurrentAnnotation] = useState(null);
    const [tool, setTool] = useState('pointer');
    const [color, setColor] = useState('#ef4444');
    const [strokeWidth, setStrokeWidth] = useState(7);
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
    const [draggingAnnotation, setDraggingAnnotation] = useState(null);
    const [hoveredShapeIndex, setHoveredShapeIndex] = useState(-1);

    // History for Undo/Redo
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const isUndoing = useRef(false);

    const updateHistory = useCallback((newAnnotations) => {
        if (isUndoing.current) {
            isUndoing.current = false;
            return;
        }
        setHistory(prev => {
            const newHist = prev.slice(0, historyIndex + 1);
            newHist.push([...newAnnotations]);
            return newHist;
        });
        setHistoryIndex(prev => prev + 1);
    }, [historyIndex]);

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            isUndoing.current = true;
            const prev = history[historyIndex - 1];
            setAnnotations(prev);
            setHistoryIndex(historyIndex - 1);
        }
    }, [history, historyIndex]);

    const getPos = (e, canvasRef, containerRef) => {
        if (!canvasRef.current || !containerRef.current) return { pixel: { x: 0, y: 0 }, norm: { x: 0, y: 0 } };

        const rect = canvasRef.current.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        return {
            pixel: { x: Math.max(0, Math.min(x, rect.width)), y: Math.max(0, Math.min(y, rect.height)) },
            norm: { x: Math.max(0, Math.min(x, rect.width)) / rect.width, y: Math.max(0, Math.min(y, rect.height)) / rect.height }
        };
    };

    const startDrawing = (e, canvasRef, containerRef) => {
        if (e.touches) e.preventDefault(); // Prevent scroll on mobile
        const pos = getPos(e, canvasRef, containerRef);
        setStartPos(pos.norm);
        setLastPos(pos.norm);

        if (tool === 'object-eraser') {
            const clickedIndex = [...annotations].reverse().findIndex(shape => isPointInShape(pos.norm, shape, canvasRef.current.getBoundingClientRect()));
            if (clickedIndex !== -1) {
                const actualIndex = annotations.length - 1 - clickedIndex;
                const newAnnotations = [...annotations];
                newAnnotations.splice(actualIndex, 1);
                setAnnotations(newAnnotations);
                updateHistory(newAnnotations);
            }
            return;
        }

        if (tool === 'pointer') {
            const clickedIndex = [...annotations].reverse().findIndex(shape => isPointInShape(pos.norm, shape, canvasRef.current.getBoundingClientRect()));
            if (clickedIndex !== -1) {
                const actualIndex = annotations.length - 1 - clickedIndex;
                setDraggingAnnotation({ ...annotations[actualIndex], index: actualIndex });
                setIsDrawing(true);
            }
            return;
        }

        setIsDrawing(true);
        if (tool === 'pencil' || tool === 'highlighter' || tool === 'eraser') {
            setCurrentAnnotation({ tool, color, strokeWidth, points: [pos.norm], isNormalized: true });
        } else if (tool === 'text') {
            const text = prompt("Enter text:");
            if (text) {
                const newAnnos = [...annotations, { tool, color, strokeWidth, x: pos.norm.x, y: pos.norm.y, text, isNormalized: true }];
                setAnnotations(newAnnos);
                updateHistory(newAnnos);
            }
            setIsDrawing(false);
        } else {
            setCurrentAnnotation({ tool, color, strokeWidth, x: pos.norm.x, y: pos.norm.y, w: 0, h: 0, isNormalized: true });
        }
    };

    const draw = (e, canvasRef, containerRef) => {
        const pos = getPos(e, canvasRef, containerRef);

        if (tool === 'object-eraser') {
            // Logic for highlight effect could go here or in component
        }

        if (tool === 'pointer' && !isDrawing) {
            const hit = annotations.some(shape => isPointInShape(pos.norm, shape, canvasRef.current.getBoundingClientRect()));
            if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'move' : 'default';
        }

        if (!isDrawing) return;

        if (tool === 'pointer' && draggingAnnotation) {
            const deltaX = pos.norm.x - lastPos.x;
            const deltaY = pos.norm.y - lastPos.y;
            const updatedShape = moveShape(draggingAnnotation, { x: deltaX, y: deltaY });
            setDraggingAnnotation(updatedShape);
            setLastPos(pos.norm);

            const newAnnotations = [...annotations];
            newAnnotations[draggingAnnotation.index] = updatedShape;
            setAnnotations(newAnnotations);
            return;
        }

        if (tool === 'pencil' || tool === 'highlighter' || tool === 'eraser') {
            setCurrentAnnotation(prev => ({ ...prev, points: [...prev.points, pos.norm] }));
        } else {
            setCurrentAnnotation(prev => ({ ...prev, w: pos.norm.x - startPos.x, h: pos.norm.y - startPos.y }));
        }
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        setDraggingAnnotation(null);
        if (currentAnnotation) {
            const newAnnos = [...annotations, currentAnnotation];
            setAnnotations(newAnnos);
            updateHistory(newAnnos);
            setCurrentAnnotation(null);
        } else if (draggingAnnotation) {
            updateHistory(annotations);
        }
    };

    const clearAnnotations = () => {
        setAnnotations([]);
        setHistory([]);
        setHistoryIndex(-1);
        setCurrentAnnotation(null);
    };

    return {
        annotations,
        setAnnotations,
        currentAnnotation,
        tool,
        setTool,
        color,
        setColor,
        strokeWidth,
        setStrokeWidth,
        startDrawing,
        draw,
        stopDrawing,
        clearAnnotations,
        handleUndo,
        history,
        historyIndex
    };
};
