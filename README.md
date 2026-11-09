# LID Table Trainer

An interactive trainer for **latency-insensitive design (LID)** traces, in the style of
CSEE 4868 (Columbia) Lectures 11–12 and Homework 3, Problem 3. You describe a system of
shells, channels, queues and relay stations, the page draws its schematic and a blank
HW3-style table, you fill the table, and the page checks every cell and explains what
you got wrong. An **▶ Animate** view then plays the trace clock by clock on the schematic,
with a written explanation of each cycle and the solution table filling in row by row.

Everything runs in the browser. There is no server, no framework and no build step
needed to use it: `index.html` is self-contained.

## Run it

* **Simplest**: download or clone the repo and open `index.html` in a browser.
* **With a local URL** (optional, e.g. to avoid `file://` quirks):

  ```sh
  python3 -m http.server 8000      # then open http://localhost:8000/
  ```

* **Online**: enable GitHub Pages for the repo (Settings → Pages → *Deploy from a branch*,
  branch `main`, folder `/ (root)`) and the trainer is served at
  `https://<your-user>.github.io/<repo>/`.

The IBM Plex fonts are loaded from Google Fonts; offline, the page falls back to your
system fonts. The spec and your answers are autosaved in the browser's `localStorage`.

## Using the trainer

1. **Build your own** — load one of the examples (HW3 3(b)–(e), the Lecture 12 MAC as on
   the slides, pipelines / loops / forks with relay stations) or write a spec (format below),
   then *Generate the table*.
2. **Fill the table.** Each channel cell is `data(void, stop)`; queue columns (`q`) list the
   tokens stored in the input queue at that cycle, head first, with `\2,7` meaning the head
   was consumed at that cycle. Enter / ↑ / ↓ move along a column.
3. **Check my answers** marks every cell and explains each mistake; **Reveal solution** and
   **Explain cycle by cycle** are there when you are stuck.
4. **Challenge me** generates a fresh random exercise (random netlist or course templates,
   with filters for shells, feedback, relay stations, queue size, void and stop rates, seed).
5. **▶ Animate** (tab, or the button under the table) switches to the animation of the
   current spec: play / step / scrub through the cycles, read what happens at each cycle
   under the schematic, and watch the table build up.

### Spec format

```
cycles 15            # timestamps n = 1..15
queue 2              # input-queue capacity (number or inf)

shell S              # a shell encapsulating one core
  in x               # primary input channel
  in p <- A.q rs 1   # channel from register q of shell A, with 1 relay station
  reg a = x + y init 2   # flip-flop: a(n+1) = x(n) + y(n); init = value at n = 1
  reg m = a * z init -   # "-" = unknown value

output m = S.m       # primary output, read from S.m

x: 3 2 2v 1 4 5      # tokens the environment sends on x; "2v" = void token
stop m: 0 0 0 0 1 0  # stop bits the environment asserts on m
```

Expressions may use `+ - * / %`, comparisons, `&& || !` and `c ? a : b`.

### Protocol conventions

The simulator implements the shell of Lecture 12 (slide 5) with one-stop-to-stall
backpressure, and the relay station with capacity 2, latency 1 and the Lecture 12
optimizations. The *Conventions* tab in the page states the equations and the rules in
words. Validated against the filled tables of HW3 (Tables 4, 5, 7) and the Lecture 12 MAC
slide.

## Repository layout

```
index.html        built page (committed, so the repo works without building)
build.py          assembles index.html from src/
src/
  core.js         LID simulator: spec parser, elaboration, cycle-accurate simulation,
                  strict reference simulation, throughput analysis  (window.LID)
  trainer.js      trainer UI: examples, schematic drawing, table, checker, explanations,
                  random exercise generator, autosave, view switching
  animator.js     animation view: schematic with recorded geometry, token overlay,
                  per-cycle narration, progressive table, transport  (window.LIDAnim)
  styles.css      all styles (light and dark)
  page.html       the page markup
```

After editing anything in `src/`, rebuild with

```sh
python3 build.py
```

and commit both the source and the regenerated `index.html`.

## Acknowledgements

A study aid for CSEE 4868 *System-on-Chip Platforms* (Columbia University). The
protocol follows the course's lecture notes on latency-insensitive design and the
shell and relay-station designs described in:

> L. P. Carloni, "From Latency-Insensitive Design to Communication-Based
> System-Level Design," *Proceedings of the IEEE*, vol. 103, no. 11,
> pp. 2133–2151, Nov. 2015. doi: [10.1109/JPROC.2015.2480849](https://doi.org/10.1109/JPROC.2015.2480849)