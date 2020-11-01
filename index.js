const defaultOptions = {
    image: null,
    crop_box_viewport: {
        width: '80%',
        height: '80%',
    },
    customClass: null,
    sliderContainer: null,
}
const defaultSliderOptions = {
    image_width: 0, image_height: 1,
    customDotClass: null,
    customLineClass: null,
    width: 0, height: 0,
    changeCallback: null,
}
const SVGnsp = 'http://www.w3.org/2000/svg';

const perc_to_float = n => parseFloat(n.substr(0, n.indexOf('%')));
const px_to_float = n => parseFloat(n.substr(0, n.indexOf('px')));

async function _getImageData(img) {
    const blob = await fetch(img)
        .then(res => res.blob())
        .then(b => b)
        .catch(err => {
            throw err;
        });
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = evt => {
            if (evt.target.result) {
                let i = new Image();
                i.src = evt.target.result;
                i.onload = function() {
                    res({ width: i.width, height: i.height, bin: i })
                }
            }
            else rej(new Error ('file reader result undefined'));
        }
        fr.readAsDataURL(blob);
    })
}

function clamp(num, hi, lo) {
    if (num > hi) return hi;
    if (num < lo) return lo;
    return num;
}

class Cropper {
    constructor(selector, options) {
        if (typeof selector === 'string') {
            this.container = document.querySelector(selector);
        } else if (selector instanceof HTMLElement) {
            this.container = selector;
        } else {
            throw new Error('invalid selector ' + selector + ' supplied');
        }
        this.container.style.overflow = 'hidden';

        this.container_dimensions = {
            width: this.container.clientWidth || this.container.offsetWidth,
            height: this.container.clientHeight || this.container.offsetHeight,
        };

        this.scaling = 1;
        this.crop_box_ref = document.createElement('div');
        this.crop_box_ref.className = `_crp_crop_box ${options.customClass ? options.customClass : ''}`;
        this.main_canvas = document.createElement('canvas');
        this.main_canvas.className = '_crp_visible_canvas';
        this.hidden_canvas = document.createElement('canvas');
        this.container.appendChild(this.main_canvas);
        this._create_crop_box_wrapper();

        let vp_dims = this._parseViewportDimensions(options.crop_box_viewport);
        if (vp_dims === undefined) throw new Error('invalid viewport dimensions supplied');
        this.crop_box_dimensions = { ...vp_dims };
        this.crop_box_ref.style.width = `${vp_dims.width}px`;
        this.crop_box_ref.style.height = `${vp_dims.height}px`;

        this.image = {
            path: options.image,
            bin: null,
            width: 0,
            height: 0,
        }

        this.canvas_drag_state = {
            is_dragging: false,
            top: 0,
            left: 0,
        };

        this.slider = new Slider(document.querySelector(options.sliderContainer), { 
            width: this.container_dimensions.width, 
            height: 40,
            image_width: this.image.width,
            image_height: this.image.height,
        });

        this._setCanvasDragState = this._setCanvasDragState.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._dragCanvas = this._dragCanvas.bind(this);
    }

    static async _init(selector, options) {
        const cropper = new Cropper(selector, { ...defaultOptions, ...options });
        let data = await _getImageData(options.image)
            .then(obj => obj)
            .catch(err => {
                throw err;
            });
        cropper.image = {
            ...cropper.image,
            ...data,
        };
        cropper._setCanvasDims();
        cropper.slider.setImgDimensions(cropper.image.width, cropper.image.height);
        cropper.slider.setScaleBounds(cropper.crop_box_dimensions.width, cropper.crop_box_dimensions.height);
        cropper.slider.mapScalingToValue();
        cropper.slider._setDotX(cropper.slider.value / cropper.slider.step);
        cropper.slider._dragDot();
        cropper.slider.changeCallback = () => {
            cropper.scaling = cropper.slider.value;
            cropper.main_canvas.width = cropper.image.width * cropper.scaling;
            cropper.main_canvas.height = cropper.image.height * cropper.scaling;
            cropper._draw_img(cropper.image.width, cropper.image.height);
        };
        const { width, height } = cropper.image;
        cropper._draw_img(width, height);
        cropper._setCanvasPosition();
        cropper._dragCanvas();
        cropper.container.addEventListener('mousedown', () => cropper._setCanvasDragState({ is_dragging: true }));
        cropper.container.addEventListener('mouseup', () => cropper._setCanvasDragState({ is_dragging: false }));
        cropper.container.addEventListener('mouseout', () => cropper._setCanvasDragState({ is_dragging: false }));
        cropper.container.addEventListener('mousemove', cropper._onMouseMove);
        return cropper;
    }

    _parseViewportDimensions(dims) {
        let { width: w, height: h } = this.container_dimensions;
        let perc = /%/i, px = /px/i;
        return (
            perc.test(dims.width) && perc.test(dims.height)
                ? { width:  (w/100) * perc_to_float(dims.width), height: (h/100) * perc_to_float(dims.height) }
                : px.test(dims.width) && px.test(dims.height)
                    ? { width: px_to_float(dims.width), height: px_to_float(dims.height) }
                    : typeof dims.width === 'number' && typeof dims.height === 'number'
                        ? { ...dims }
                        : undefined 
        );
    }

    _setCanvasDims() {
        const { width: iw, height: ih } = this.image;
        const { width: cw, height: ch } = this.container_dimensions;
        this.main_canvas.width = iw < cw ? cw : iw;
        this.main_canvas.height = ih < ch ? ch : ih;
    }

    _draw_img(w, h) {
        let ctx = this.main_canvas.getContext('2d');
        ctx.clearRect(0, 0, w * this.scaling, h * this.scaling);
        ctx.drawImage(this.image.bin, 0, 0, w * this.scaling, h * this.scaling);
    }

    _create_crop_box_wrapper() {
        const wrp = document.createElement('div');
        wrp.className = '_crp_crop_box_wrapper';
        wrp.appendChild(this.crop_box_ref);
        this.container.appendChild(wrp);
    }

    _setCanvasPosition() {
        const { width: cw, height: ch } = this.container_dimensions;
        const canvw = this.main_canvas.width, canh = this.main_canvas.height;
        const top = (ch / 2) - (canh / 2);
        const left = (cw / 2) - (canvw / 2);
        this._setCanvasDragState({ left, top });
    }

    _setCanvasDragState(st) {
        this.canvas_drag_state = {
            ...this.canvas_drag_state,
            ...st,
        };
    }

    _getScaledDimensions() {
        return {
            width: this.image.width * this.slider.value,
            height: this.image.height * this.slider.value,
        }
    }

    _dragCanvas() {
        const { left, top } = this.canvas_drag_state;
        this.main_canvas.style.transform = `translate3d(${left}px, ${top}px, 0px)`;
    }

    _onMouseMove(evt) {
        const { is_dragging, left: cl, top: ct } = this.canvas_drag_state;
        if (is_dragging) {
            const { movementX: mx, movementY: my } = evt;
            let left = clamp(cl + mx, 0, this.container_dimensions.width - (this.image.width * this.scaling));
            let top = clamp(ct + my, 0, this.container_dimensions.height - (this.image.height * this.scaling));
            this._setCanvasDragState({ left, top });
            requestAnimationFrame(this._dragCanvas);
        }
    }

    result() {
        this.hidden_canvas.width = this.crop_box_dimensions.width;
        this.hidden_canvas.height = this.crop_box_dimensions.height;
        const hid_ctx = this.hidden_canvas.getContext('2d');
        const main_ctx = this.main_canvas.getContext('2d');
        hid_ctx.clearRect(
            0, 0, 
            this.image.width * this.scaling, 
            this.image.height * this.scaling
        );
        let imgData = main_ctx.getImageData(
            Math.abs(this.canvas_drag_state.left),
            Math.abs(this.canvas_drag_state.top),
            this.crop_box_dimensions.width,
            this.crop_box_dimensions.height
        );
        hid_ctx.putImageData(imgData, 0, 0);
        return this.hidden_canvas.toDataURL('image/jpeg');
    }

} 

class Slider {
    constructor(parent, options) {
        const opts = { ...defaultSliderOptions, ...options };
        const { customDotClass, customLineClass } = opts;
        this.dimensions = { width: opts.width, height: opts.height };
        this.image_width = 0; this.image_height = 0;
        this.customDotClass = customDotClass;
        this.customLineClass = customLineClass;
        this.parent = parent;
        this.max_x = opts.width - 20;
        this.min_w = 0; this.min_h = 0;
        this.upper_bound = 0; this.lower_bound = 0;
        this.step = 0; this.value = 1;
        this.changeCallback = opts.changeCallback;

        this.wrapper = document.createElement('div');
        this.wrapper.className = '_cr_slider_wrapper';
        const line = document.createElementNS(SVGnsp, 'svg');
        line.classList.add('_cr_svg_line');
        if (this.customLineClass) {
            line.classList.add(this.customLineClass);
        }
        line.setAttributeNS(null, 'viewBox', `0 0 ${options.width} ${options.height}`);
        line.setAttributeNS(null, 'preserveAspectRatio', 'none');
        line.setAttributeNS(null, 'x', '0');
        line.setAttributeNS(null, 'y', '0');
        line.setAttribute('style', 'width:100%;height:100%;');
        const path = document.createElementNS(SVGnsp, 'path');
        path.setAttributeNS(null, 'd', `M0,${options.height/2} l${options.width},0`);
        path.setAttribute('style', 'stroke:#000;stroke-width:2;');
        line.appendChild(path);

        const dot = document.createElementNS(SVGnsp, 'circle');
        dot.setAttributeNS(null, 'cx', '10');
        dot.setAttributeNS(null, 'cy', `${this.dimensions.height/2}`);
        dot.setAttributeNS(null, 'r', '10');
        dot.setAttributeNS(null, 'fill', '#141414;');
        dot.setAttribute('style', 'cursor: pointer;')
        line.appendChild(dot);
        
        this.wrapper.appendChild(line);
        this.parent.appendChild(this.wrapper);

        this.dragging_state = {
            is_dragging: false,
            x: 0,
        }

        this._dragDot = this._dragDot.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this.setValue = this.setValue.bind(this);

        this.wrapper.querySelector('circle').addEventListener('mousedown', () => this.dragging_state.is_dragging = true);
        document.body.addEventListener('mouseup', () => this.dragging_state.is_dragging = false);
        document.body.addEventListener('mousemove', this._onMouseMove);
    }

    setImgDimensions(w, h) {
        this.image_height = h; this.image_width = w;
    }

    setScaleBounds(w, h) {
        this.min_w = w; this.min_h = h;
    }

    mapScalingToValue() {
        let params = {
            max_dim: 0,
            min_dim: 0
        };
        if (this.image_width > this.image_height) params = { max_dim: this.image_width, min_dim: this.min_w };
        else params = { max_dim: this.image_height, min_dim: this.min_h };
        const { max_dim, min_dim } = params;
        const lower_bound = min_dim / max_dim;
        const upper_bound = 3;
        this.lower_bound = lower_bound;
        this.upper_bound = upper_bound;
        this._setStep();
    }

    _setStep() {
        let range = this.upper_bound - this.lower_bound;
        this.step = range / this.dimensions.width;
    }

    setValue(v) {
        this.value = v;
    }

    _onMouseMove(evt) {
        const { is_dragging, x } = this.dragging_state;
        if (is_dragging) {
            const { movementX: mx } = evt;
            this.dragging_state = { 
                ...this.dragging_state, 
                x: clamp(x + mx, this.max_x, 0)
            };
            requestAnimationFrame(this._dragDot);
        }
    }
    
    _dragDot() {
        const { x } = this.dragging_state;
        this.setValue(x*this.step);
        this.wrapper.querySelector('circle').style.transform = `translate3d(${x}px, 0px, 0px)`;
        if (this.changeCallback !== null) this.changeCallback();
    }

    _setDotX(x) {
        this.dragging_state.x = x;
    }
}