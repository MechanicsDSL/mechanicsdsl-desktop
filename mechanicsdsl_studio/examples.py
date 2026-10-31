"""Built-in example worksheets for the gallery. Each one compiles in a few seconds."""

EXAMPLES = [
    {
        "id": "simple-pendulum",
        "title": "Simple pendulum",
        "category": "Oscillations",
        "summary": "A point mass on a rigid rod: the starting point of Lagrangian mechanics.",
        "settings": {"t_end": 10, "points": 1000},
        "source": r"""\system{simple_pendulum}
\defvar{theta}{Angle from vertical}{rad}
\parameter{m}{1.0}{kg}
\parameter{l}{1.0}{m}
\parameter{g}{9.81}{m/s^2}
\lagrangian{\frac{1}{2}*m*l^2*\dot{theta}^2 - m*g*l*(1-\cos{theta})}
\initial{theta=0.5, theta_dot=0}
""",
    },
    {
        "id": "damped-oscillator",
        "title": "Damped oscillator",
        "category": "Oscillations",
        "summary": "A spring and mass with linear damping applied as a generalised force.",
        "settings": {"t_end": 15, "points": 1200},
        "source": r"""\system{damped_oscillator}
\defvar{x}{Displacement}{m}
\parameter{m}{1.0}{kg}
\parameter{k}{10.0}{N/m}
\parameter{b}{0.5}{N*s/m}
\lagrangian{\frac{1}{2}*m*\dot{x}^2 - \frac{1}{2}*k*x^2}
\force{-b*\dot{x}}
\initial{x=1.0, x_dot=0}
""",
    },
    {
        "id": "coupled-oscillators",
        "title": "Coupled oscillators",
        "category": "Oscillations",
        "summary": "Two masses and three springs between fixed walls; energy passes between the modes.",
        "settings": {"t_end": 20, "points": 1500},
        "source": r"""\system{coupled_oscillators}
\defvar{x1}{Position of mass 1}{m}
\defvar{x2}{Position of mass 2}{m}
\parameter{m1}{1.0}{kg}
\parameter{m2}{1.0}{kg}
\parameter{k1}{10.0}{N/m}
\parameter{k2}{2.0}{N/m}
\parameter{k3}{10.0}{N/m}
\lagrangian{
    \frac{1}{2}*m1*\dot{x1}^2 + \frac{1}{2}*m2*\dot{x2}^2
    - \frac{1}{2}*k1*x1^2 - \frac{1}{2}*k2*(x2-x1)^2 - \frac{1}{2}*k3*x2^2
}
\initial{x1=0.5, x2=0}
""",
    },
    {
        "id": "double-pendulum",
        "title": "Double pendulum",
        "category": "Chaos",
        "summary": "Two coupled pendulums. Small changes to the starting angles give entirely different motion.",
        "settings": {"t_end": 20, "points": 2000},
        "source": r"""\system{double_pendulum}
\defvar{theta1}{Upper arm angle}{rad}
\defvar{theta2}{Lower arm angle}{rad}
\parameter{m1}{1.0}{kg}
\parameter{m2}{1.0}{kg}
\parameter{l1}{1.0}{m}
\parameter{l2}{1.0}{m}
\parameter{g}{9.81}{m/s^2}
\lagrangian{
    \frac{1}{2}*(m1+m2)*l1^2*\dot{theta1}^2
    + \frac{1}{2}*m2*l2^2*\dot{theta2}^2
    + m2*l1*l2*\dot{theta1}*\dot{theta2}*\cos{theta1-theta2}
    - (m1+m2)*g*l1*(1-\cos{theta1})
    - m2*g*l2*(1-\cos{theta2})
}
\initial{theta1=2.5, theta2=2.0}
""",
    },
    {
        "id": "elastic-pendulum",
        "title": "Elastic pendulum",
        "category": "Chaos",
        "summary": "A mass on a spring that is free to swing; radial and angular motion exchange energy.",
        "settings": {"t_end": 20, "points": 2000},
        "source": r"""\system{elastic_pendulum}
\defvar{r}{Length of the spring}{m}
\defvar{theta}{Angle from vertical}{rad}
\parameter{m}{1.0}{kg}
\parameter{k}{40.0}{N/m}
\parameter{l0}{1.0}{m}
\parameter{g}{9.81}{m/s^2}
\lagrangian{\frac{1}{2}*m*(\dot{r}^2 + r^2*\dot{theta}^2) + m*g*r*\cos{theta} - \frac{1}{2}*k*(r - l0)^2}
\initial{r=1.3, theta=0.6, r_dot=0, theta_dot=0}
""",
    },
    {
        "id": "pendulum-on-cart",
        "title": "Pendulum on a cart",
        "category": "Mechanisms",
        "summary": "A pendulum hanging from a cart that slides freely; the cart recoils as the pendulum swings.",
        "settings": {"t_end": 10, "points": 1200},
        "source": r"""\system{pendulum_on_cart}
\defvar{x}{Cart position}{m}
\defvar{theta}{Pendulum angle from vertical}{rad}
\parameter{M}{2.0}{kg}
\parameter{m}{0.5}{kg}
\parameter{l}{1.0}{m}
\parameter{g}{9.81}{m/s^2}
\lagrangian{\frac{1}{2}*(M+m)*\dot{x}^2 + m*l*\dot{x}*\dot{theta}*\cos{theta} + \frac{1}{2}*m*l^2*\dot{theta}^2 + m*g*l*\cos{theta}}
\initial{x=0, theta=2.5, x_dot=0, theta_dot=0}
""",
    },
    {
        "id": "projectile",
        "title": "Projectile",
        "category": "Mechanisms",
        "summary": "Motion under uniform gravity in two dimensions.",
        "settings": {"t_end": 2.0, "points": 400},
        "source": r"""\system{projectile}
\defvar{x}{Horizontal position}{m}
\defvar{y}{Vertical position}{m}
\parameter{m}{1.0}{kg}
\parameter{g}{9.81}{m/s^2}
\lagrangian{\frac{1}{2}*m*(\dot{x}^2 + \dot{y}^2) - m*g*y}
\initial{x=0, y=0, x_dot=10, y_dot=10}
""",
    },
    {
        "id": "kepler-orbit",
        "title": "Planetary orbit",
        "category": "Celestial",
        "summary": "The Kepler problem in polar coordinates, in astronomical units and years. The starting speed is below circular, so the orbit is an ellipse.",
        "settings": {"t_end": 3.0, "points": 1500},
        "source": r"""\system{kepler_orbit}
\defvar{r}{Distance from the Sun}{AU}
\defvar{phi}{Angle around the Sun}{rad}
\parameter{m}{1.0}{M_earth}
\parameter{GM}{39.478}{AU^3/yr^2}
\lagrangian{\frac{1}{2}*m*(\dot{r}^2 + r^2*\dot{phi}^2) + GM*m/r}
\initial{r=1.0, phi=0, r_dot=0, phi_dot=5.0}
""",
    },
    {
        "id": "figure-eight",
        "title": "Figure-eight three-body orbit",
        "category": "Celestial",
        "summary": "Three equal masses chasing each other along one figure-eight (Chenciner and Montgomery, 2000).",
        "settings": {"t_end": 6.33, "points": 1500},
        "source": r"""\system{figure8_orbit}
\defvar{x1}{x position body 1}{m}
\defvar{y1}{y position body 1}{m}
\defvar{x2}{x position body 2}{m}
\defvar{y2}{y position body 2}{m}
\defvar{x3}{x position body 3}{m}
\defvar{y3}{y position body 3}{m}
\parameter{m}{1.0}{kg}
\parameter{G}{1.0}{N*m^2/kg^2}
\lagrangian{
    0.5*m*(\dot{x1}^2+\dot{y1}^2+\dot{x2}^2+\dot{y2}^2+\dot{x3}^2+\dot{y3}^2)
    + G*m^2/\sqrt{(x1-x2)^2+(y1-y2)^2}
    + G*m^2/\sqrt{(x2-x3)^2+(y2-y3)^2}
    + G*m^2/\sqrt{(x1-x3)^2+(y1-y3)^2}
}
\initial{x1=0.97000436, y1=-0.24308753, x2=-0.97000436, y2=0.24308753, x3=0, y3=0}
\initial{x1_dot=0.466203685, y1_dot=0.43236573, x2_dot=0.466203685, y2_dot=0.43236573}
\initial{x3_dot=-0.93240737, y3_dot=-0.86473146}
""",
    },
]

BLANK = r"""\system{my_system}
\defvar{q}{Generalised coordinate}{m}
\parameter{m}{1.0}{kg}
\parameter{k}{1.0}{N/m}
\lagrangian{\frac{1}{2}*m*\dot{q}^2 - \frac{1}{2}*k*q^2}
\initial{q=1.0, q_dot=0}
"""
