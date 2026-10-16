"""
Ray Acoustic Simulation Engine for Ocean Acoustic Workbench
Provides analytical and numerical ray tracing in shallow and deep water waveguides.
"""
from __future__ import annotations
import math
from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'Segoe UI', 'DejaVu Sans', 'Arial']
plt.rcParams['axes.unicode_minus'] = False

def trace_ray_isovelocity(
    h_m: float,
    zs_m: float,
    theta_deg: float,
    r_max_m: float,
    direction: str = 'up' # 'up' (toward surface) or 'down' (toward bottom)
) -> dict:
    """
    Traces a single ray in an isovelocity waveguide with water depth h_m.
    direction: 'up' means launched towards sea surface (z=0)
               'down' means launched towards seabed (z=h_m)
    """
    theta_rad = math.radians(abs(theta_deg))
    tan_th = math.tan(theta_rad)
    if tan_th <= 1e-9:
        # Horizontal ray
        return {
            'angle_deg': theta_deg,
            'direction': direction,
            'r_points': [0.0, r_max_m],
            'z_points': [zs_m, zs_m],
            'surface_bounces': 0,
            'bottom_bounces': 0,
            'total_bounces': 0,
            'bounce_events': [],
            'last_bounce_r_m': None,
            'margin_to_rmax_m': None,
            'end_depth_m': zs_m
        }

    r_curr = 0.0
    z_curr = zs_m
    v_dir = -1 if direction == 'up' else 1  # -1 towards z=0, +1 towards z=h_m

    r_pts = [0.0]
    z_pts = [zs_m]
    bounce_events = []
    surf_count = 0
    bot_count = 0

    while True:
        if v_dir == -1:
            # Heading towards surface z=0
            dist_z = z_curr - 0.0
            step_r = dist_z / tan_th
            if r_curr + step_r >= r_max_m:
                # Reaches r_max before hitting surface
                z_end = z_curr - (r_max_m - r_curr) * tan_th
                r_pts.append(r_max_m)
                z_pts.append(z_end)
                break
            r_curr += step_r
            z_curr = 0.0
            surf_count += 1
            v_dir = 1
            r_pts.append(r_curr)
            z_pts.append(0.0)
            bounce_events.append({'type': 'surface', 'r_m': round(r_curr, 2), 'z_m': 0.0})
        else:
            # Heading towards bottom z=h_m
            dist_z = h_m - z_curr
            step_r = dist_z / tan_th
            if r_curr + step_r >= r_max_m:
                # Reaches r_max before hitting bottom
                z_end = z_curr + (r_max_m - r_curr) * tan_th
                r_pts.append(r_max_m)
                z_pts.append(z_end)
                break
            r_curr += step_r
            z_curr = h_m
            bot_count += 1
            v_dir = -1
            r_pts.append(r_curr)
            z_pts.append(h_m)
            bounce_events.append({'type': 'bottom', 'r_m': round(r_curr, 2), 'z_m': h_m})

    last_r = bounce_events[-1]['r_m'] if bounce_events else 0.0
    margin = round(r_max_m - last_r, 2) if bounce_events else None

    return {
        'angle_deg': theta_deg,
        'direction': direction,
        'r_points': r_pts,
        'z_points': z_pts,
        'surface_bounces': surf_count,
        'bottom_bounces': bot_count,
        'total_bounces': surf_count + bot_count,
        'bounce_events': bounce_events,
        'last_bounce_r_m': last_r,
        'margin_to_rmax_m': margin,
        'end_depth_m': round(z_pts[-1], 2)
    }

def run_ray_tracing_job(
    water_depth_m: float = 100.0,
    source_depth_m: float = 50.0,
    angles_deg: list[float] | None = None,
    range_max_km: float = 5.0,
    sound_speed_mps: float = 1500.0,
    launch_direction: str = 'both', # 'both', 'up', 'down'
    output_dir: Path | str | None = None
) -> dict:
    if angles_deg is None:
        angles_deg = [5.0, 15.0, 30.0, 45.0, 60.0]
    angles_deg = sorted(list(set(angles_deg)))
    r_max_m = range_max_km * 1000.0

    if output_dir is not None:
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
    else:
        out_path = None

    dirs_to_run = ['up', 'down'] if launch_direction == 'both' else [launch_direction]
    all_results = {}

    for d in dirs_to_run:
        dir_rays = []
        for ang in angles_deg:
            ray = trace_ray_isovelocity(water_depth_m, source_depth_m, ang, r_max_m, direction=d)
            dir_rays.append(ray)
        all_results[d] = dir_rays

    # Generate visualization
    fig, ax = plt.subplots(figsize=(11.5, 5.5), facecolor='#f8fafc', dpi=150)
    fig.subplots_adjust(left=0.08, right=0.96, top=0.90, bottom=0.12)

    # Plot boundaries
    r_km = range_max_km
    ax.axhline(0, color='#0284c7', lw=2.5, linestyle='-', label='Sea Surface (z = 0 m)', zorder=2)
    ax.axhline(water_depth_m, color='#92400e', lw=3.0, linestyle='-', label=f'Seabed (z = {water_depth_m:g} m)', zorder=2)
    ax.axhspan(-water_depth_m*0.06, 0, color='#e0f2fe', alpha=0.5, zorder=1)
    ax.axhspan(water_depth_m, water_depth_m*1.06, color='#fef3c7', alpha=0.6, zorder=1)

    colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2']

    for d in dirs_to_run:
        dir_rays = all_results[d]
        linestyle = '-' if d == 'up' else '--'
        for i, ray in enumerate(dir_rays):
            c = colors[i % len(colors)]
            r_arr = np.array(ray['r_points']) / 1000.0
            z_arr = np.array(ray['z_points'])
            dir_text = "Up" if d == 'up' else "Down"
            label = f"{ray['angle_deg']:g}° ({dir_text}, Bounces={ray['total_bounces']})"
            ax.plot(r_arr, z_arr, color=c, lw=1.6 if d=='up' else 1.2, linestyle=linestyle, label=label, alpha=0.88, zorder=3)
            # Annotate bounce points for small angles or end points
            if ray['total_bounces'] <= 6:
                for b in ray['bounce_events']:
                    ax.plot(b['r_m']/1000.0, b['z_m'], marker='o', markersize=4, color=c, zorder=4)

    # Plot source position
    ax.plot([0], [source_depth_m], marker='*', markersize=14, color='#e11d48', markeredgecolor='#881337', markeredgewidth=1.2, label=f'Source ({source_depth_m:g} m)', zorder=6)

    ax.set_xlim(-0.03 * r_km, 1.02 * r_km)
    ax.set_ylim(water_depth_m * 1.06, -water_depth_m * 0.06) # Invert y-axis (depth increases downwards)
    ax.set_xlabel('Horizontal Range r (km)', fontsize=11, fontweight='bold', color='#1e293b')
    ax.set_ylabel('Depth z (m)', fontsize=11, fontweight='bold', color='#1e293b')
    ax.set_title(
        f'Ray Tracing in Shallow Water (c = {sound_speed_mps:g} m/s, H = {water_depth_m:g} m, zs = {source_depth_m:g} m, r = {range_max_km:g} km)',
        fontsize=12, fontweight='bold', pad=12, color='#0f172a'
    )
    ax.grid(True, linestyle=':', alpha=0.5, color='#94a3b8')
    ax.legend(loc='center left', bbox_to_anchor=(1.01, 0.5), frameon=True, facecolor='#ffffff', edgecolor='#cbd5e1', fontsize=8.5)
    plt.tight_layout()

    if out_path:
        plot_file = out_path / 'ray_trajectories.png'
        fig.savefig(plot_file, dpi=180, bbox_inches='tight')
        plt.close(fig)

        # Save summary JSON
        summary = {
            'task_type': 'shallow_water_ray_tracing',
            'water_depth_m': water_depth_m,
            'source_depth_m': source_depth_m,
            'sound_speed_mps': sound_speed_mps,
            'range_max_km': range_max_km,
            'angles_deg': angles_deg,
            'launch_direction': launch_direction,
            'results': all_results
        }
        (out_path / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

        # Save CSV curve data
        csv_lines = ['angle_deg,direction,total_bounces,surface_bounces,bottom_bounces,last_bounce_r_m,margin_m,end_depth_m']
        for d in dirs_to_run:
            for r in all_results[d]:
                csv_lines.append(f"{r['angle_deg']},{r['direction']},{r['total_bounces']},{r['surface_bounces']},{r['bottom_bounces']},{r['last_bounce_r_m']},{r['margin_to_rmax_m']},{r['end_depth_m']}")
        (out_path / 'reflection_stats.csv').write_text('\n'.join(csv_lines), encoding='utf-8')

    return {
        'water_depth_m': water_depth_m,
        'source_depth_m': source_depth_m,
        'range_max_km': range_max_km,
        'angles_deg': angles_deg,
        'all_results': all_results
    }
