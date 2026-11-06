#!/usr/bin/env python3
"""
Lavandería Express - Sistema de Atención al Cliente
Un sistema integral para gestión de lavandería con registro, historial,
informes mensuales y impresión de tickets.
"""

import sqlite3
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# --- Configuración ---
DB_NAME = "lavanderia.db"
CONFIG_FILE = "config.json"


def init_db():
    """Inicializar la base de datos SQLite."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            telefono TEXT,
            email TEXT,
            fecha_registro TEXT DEFAULT (datetime('now'))
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS servicios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER,
            tipo_servicio TEXT NOT NULL,
            precio REAL NOT NULL,
            fecha TEXT DEFAULT (datetime('now')),
            peso INTEGER DEFAULT 0,
            estatus TEXT DEFAULT 'completado',
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS config_sistema (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL DEFAULT ''
        )
    """)
    # Configuraciones por defecto
    cur.execute("""
        INSERT OR IGNORE INTO config_sistema (clave, valor) VALUES ('nombre_lavanderia', 'Lavandería Express')
    """)
    cur.execute("""
        INSERT OR IGNORE INTO config_sistema (clave, valor) VALUES ('precio_kg_lavado', '15.00')
    """)
    cur.execute("""
        INSERT OR IGNORE INTO config_sistema (clave, valor) VALUES ('precio_kg_secado', '10.00')
    """)
    con.commit()
    con.close()


def cargar_config():
    """Cargar configuración desde archivo JSON."""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def guardar_config(config):
    """Guardar configuración a archivo JSON."""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def registrar_cliente(nombre, telefono="", email=""):
    """Registrar un nuevo cliente en la base de datos."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()
    cur.execute(
        "INSERT INTO clientes (nombre, telefono, email) VALUES (?, ?, ?)",
        (nombre, telefono, email),
    )
    cliente_id = cur.lastrowid
    con.commit()
    con.close()
    return cliente_id


def registrar_servicio(cliente_id, tipo_servicio, precio, peso=0):
    """Registrar un servicio prestado a un cliente."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute(
        "INSERT INTO servicios (cliente_id, tipo_servicio, precio, peso, fecha, estatus) "
        "VALUES (?, ?, ?, ?, ?, 'completado')",
        (cliente_id, tipo_servicio, precio, peso, fecha),
    )
    # Actualizar configuración de precios si es nuevo
    config = cargar_config()
    if tipo_servicio not in config.get("servicios_precios", {}):
        config.setdefault("servicios_precios", {})[tipo_servicio] = precio
        guardar_config(config)
    con.commit()
    con.close()


def obtener_historial_fecha(inicio, fin):
    """Obtener servicios en un rango de fechas."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM servicios WHERE fecha >= ? AND fecha <= ?",
        (inicio, fin),
    )
    rows = cur.fetchall()
    con.close()
    return rows


def obtener_estadisticas_mes(anyo, mes):
    """Obtener estadísticas resumidas para un mes y año."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()
    inicio = f"{anyo}-{mes:02d}-01"
    if mes == 12:
        fin = f"{anyo + 1}-01-01"
    else:
        fin = f"{anyo}-{mes + 1:02d}-01"

    cur.execute(
        "SELECT COUNT(*) as total, SUM(precio) as ingreso_total, SUM(peso) as peso_total "
        "FROM servicios WHERE fecha >= ? AND fecha < ?",
        (inicio, fin),
    )
    row = cur.fetchone()

    # Servicios por tipo
    cur.execute(
        "SELECT tipo_servicio, COUNT(*) as cantidad, SUM(precio) as ingreso "
        "FROM servicios WHERE fecha >= ? AND fecha < ? "
        "GROUP BY tipo_servicio",
        (inicio, fin),
    )
    por_tipo = cur.fetchall()

    con.close()
    return {
        "total_servicios": row[0] or 0,
        "ingreso_total": row[1] or 0.0,
        "peso_total": row[2] or 0,
        "por_tipo": [{"tipo": r[0], "cantidad": r[1], "ingreso": r[2]} for r in por_tipo],
    }


def imprimir_ticket(datos_ticket):
    """Mostrar un ticket formateado en consola (simulación de impresión)."""
    print("\n" + "=" * 50)
    ticket_nombre = datos_ticket.get("nombre_lavanderia", "Lavandería Express")
    print(f"TICKET: {ticket_nombre}")
    print("=" * 50)
    print(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 50)
    print(f"Cliente: {datos_ticket.get('cliente', 'N/A')}")
    print(f"Teléfono: {datos_ticket.get('telefono', 'N/A')}")
    print(f"Servicio: {datos_ticket.get('servicio', 'N/A')}")
    print(f"Peso: {datos_ticket.get('peso', 0)} kg")
    print(f"Precio: ${datos_ticket.get('precio', 0):.2f}")
    print("-" * 50)
    print(f"Total: ${datos_ticket.get('precio', 0):.2f}")
    print("=" * 50)
    print("¡Gracias por su visita!")
    print("=" * 50 + "\n")


def obtener_dashboard():
    """Obtener datos completos para el dashboard general."""
    con = sqlite3.connect(DB_NAME)
    cur = con.cursor()

    # Total de clientes
    cur.execute("SELECT COUNT(*) FROM clientes")
    total_clientes = cur.fetchone()[0]

    # Total de servicios
    cur.execute("SELECT COUNT(*) FROM servicios")
    total_servicios = cur.fetchone()[0]

    # Ingresos totales
    cur.execute("SELECT SUM(precio) FROM servicios")
    ingreso_total = cur.fetchone()[0] or 0.0

    # Peso total
    cur.execute("SUM(peso) FROM servicios")
    peso_total = cur.fetchone()[0] or 0

    # Servicios del mes actual
    hoy = datetime.now()
    inicio_mes = f"{hoy.year}-{hoy.month:02d}-01"
    fin_mes = f"{hoy.year}-{hoy.month + 1:02d}-01" if hoy.month < 12 else f"{hoy.year + 1}-01-01"
    cur.execute(
        "SELECT COUNT(*), SUM(precio), SUM(peso) FROM servicios WHERE fecha >= ? AND fecha < ?",
        (inicio_mes, fin_mes),
    )
    mes_data = cur.fetchone()
    servicios_mes = mes_data[0] or 0
    ingreso_mes = mes_data[1] or 0.0
    peso_mes = mes_data[2] or 0

    # Servicios por tipo (todo el historial)
    cur.execute(
        "SELECT tipo_servicio, COUNT(*), SUM(precio) FROM servicios GROUP BY tipo_servicio"
    )
    por_tipo = cur.fetchall()

    con.close()
    return {
        "total_clientes": total_clientes,
        "total_servicios": total_servicios,
        "ingreso_total": ingreso_total,
        "peso_total": peso_total,
        "servicios_mes": servicios_mes,
        "ingreso_mes": ingreso_mes,
        "peso_mes": peso_mes,
        "por_tipo": [{"tipo": r[0], "cantidad": r[1], "ingreso": r[2]} for r in por_tipo],
    }


def ver_dashboard():
    """Mostrar dashboard general con métricas clave."""
    datos = obtener_dashboard()

    print("\n" + "=" * 70)
    print("=== DASHBOARD LAVANDERÍA EXPRESS ===")
    print("=" * 70)

    # Métricas principales en filas
    print(f"{"Métrica":<25} {"Valor":>20}")
    print("-" * 45)
    print(f"{"Clientes totales":<25} {datos["total_clientes"]:>20}")
    print(f"{"Servicios totales":<25} {datos["total_servicios"]:>20}")
    print(f"{"Ingresos totales":<25} ${datos["ingreso_total"]:>18.2f}")
    print(f"{"Peso total":<25} {datos["peso_total"]:>20} kg")
    print()

    # Estadísticas del mes actual
    print(f"=== MES ACTUAL: {datetime.now().strftime('%B %Y').upper()} ===")
    print(f"{"Servicios este mes":<25} {datos["servicios_mes"]:>20}")
    print(f"{"Ingresos este mes":<25} ${datos["ingreso_mes"]:>18.2f}")
    print(f"{"Peso este mes":<25} {datos["peso_mes"]:>20} kg")
    print()

    # Gráfico de pastel textual por tipo de servicio
    print("=== DISTRIBUCIÓN POR TIPO DE SERVICIO ===")
    total_ingreso = sum(s["ingreso"] for s in datos["por_tipo"])
    print(f"{'Tipo':<15} {'Porcentaje':>10} {'Barra'}")
    print("-" * 40)
    if total_ingreso > 0 and datos["por_tipo"]:
        for s in datos["por_tipo"]:
            porcentaje = (s["ingreso"] / total_ingreso) * 100
            barra_largo = int(porcentaje / 5)  # 5% por bloque
            barra = "▮" * barra_largo + "▯" * (20 - barra_largo)
            print(f"  {s['tipo']:<15} {porcentaje:>9.1f}% {barra}")
    else:
        print("  No hay datos de servicio")

    print("=" * 70 + "\n")


def menu_principal():
    """Mostrar el menú principal y gestionar las opciones."""
    while True:
        print("\n" + "=" * 50)
        print("SISTEMA LAVANDERÍA EXPRESS")
        print("=" * 50)
        print("1. Registrar cliente nuevo")
        print("2. Registrar servicio")
        print("3. Ver historial de ventas")
        print("4. Ver estadísticas mensuales")
        print("5. Configurar nombre y precios")
        print("6. Imprimir ticket")
        print("7. Salir")
        print("8. Ver dashboard resumido")
        print("=" * 50)

        opcion = input("\nSeleccione una opción (1-8): ").strip()

        if opcion == "1":
            nombre = input("Nombre del cliente: ").strip()
            telefono = input("Teléfono (opcional): ").strip() or ""
            email = input("Email (opcional): ").strip() or ""
            cliente_id = registrar_cliente(nombre, telefono, email)
            print(f"✓ Cliente registrado con ID: {cliente_id}")

        elif opcion == "2":
            nombre_cliente = input("Nombre del cliente: ").strip()
            con = sqlite3.connect(DB_NAME)
            cur = con.cursor()
            cur.execute(
                "SELECT id FROM clientes WHERE nombre = ?", (nombre_cliente,)
            )
            row = cur.fetchone()
            if row:
                cliente_id = row[0]
                print(f"✓ Cliente existente (ID: {cliente_id})")
            else:
                telefono = input("Teléfono: ").strip() or ""
                email = input("Email: ").strip() or ""
                cliente_id = registrar_cliente(nombre_cliente, telefono, email)
                print(f"✓ Nuevo cliente registrado (ID: {cliente_id})")

            tipo_servicio = input(
                "Tipo de servicio (ej. lavado, secado, planchado): "
            ).strip()

            # Precio desde configuración o ingresar
            config = cargar_config()
            precio_default = config.get("servicios_precios", {}).get(tipo_servicio, "")
            if precio_default:
                print(f"Precio sugerido desde configuración: ${precio_default}")
                precio_input = input(
                    f"Precio [${precio_default}]: "
                ).strip()
                precio = float(precio_input) if precio_input else float(precio_default)
            else:
                precio = float(input("Precio del servicio: ").strip())

            peso = int(
                input("Peso en kg (opcional, Enter para 0): ").strip() or "0"
            )

            registrar_servicio(cliente_id, tipo_servicio, precio, peso)
            print("✓ Servicio registrado exitosamente")
            con.close()

        elif opcion == "3":
            print("\n--- Historial de los últimos 20 servicios ---")
            con = sqlite3.connect(DB_NAME)
            cur = con.cursor()
            cur.execute(
                "SELECT s.id, c.nombre, s.tipo_servicio, s.precio, s.fecha, s.peso "
                "FROM servicios s "
                "LEFT JOIN clientes c ON s.cliente_id = c.id "
                "ORDER BY s.fecha DESC LIMIT 20"
            )
            rows = cur.fetchall()
            for r in rows:
                print(
                    f"ID:{r[0]} | Cliente:{r[1]:20} | {r[2]:20} | "
                    f"${r[3]:8.2f} | {r[4]} | {r[5]}kg"
                )
            con.close()

        elif opcion == "4":
            ver_estadisticas()

        elif opcion == "5":
            print("\n--- Configuración ---")
            config = cargar_config()

            nombre_actual = config.get("nombre_lavanderia", "Lavandería Express")
            print(f"Nombre actual: {nombre_actual}")
            nuevo_nombre = input(
                f"Nuevo nombre [{nombre_actual}]: "
            ).strip()
            if nuevo_nombre:
                config["nombre_lavanderia"] = nuevo_nombre

            print(f"Precios actuales: {config.get('servicios_precios', {})}")
            for key in list(config.get("servicios_precios", {}).keys()):
                nuevo_precio = input(
                    f"Nuevo precio para {key} [${config['servicios_precios'][key]}]: "
                ).strip()
                if nuevo_precio:
                    config["servicios_precios"][key] = float(nuevo_precio)

            # Permitir agregar nuevo servicio con precio
            nuevo_serv = input(
                "Agregar nuevo servicio con precio (formato: nombre:precio) o Enter: "
            ).strip()
            if nuevo_serv:
                try:
                    nombre, precio = nuevo_serv.split(":")
                    config.setdefault("servicios_precios", {})[
                        nombre.strip()
                    ] = float(precio.strip())
                except ValueError:
                    print("Formato inválido. Use: nombre:precio")

            guardar_config(config)
            print("✓ Configuración guardada exitosamente")

        elif opcion == "6":
            # Generar y mostrar ticket
            nombre_cliente = input("Nombre del cliente: ").strip()
            con = sqlite3.connect(DB_NAME)
            cur = con.cursor()
            cur.execute(
                "SELECT s.tipo_servicio, s.precio, s.peso, s.fecha "
                "FROM servicios s "
                "LEFT JOIN clientes c ON s.cliente_id = c.id "
                "WHERE c.nombre = ? "
                "ORDER BY s.fecha DESC LIMIT 1",
                (nombre_cliente,),
            )
            row = cur.fetchone()
            con.close()

            if row:
                ticket_data = {
                    "cliente": nombre_cliente,
                    "servicio": row[0],
                    "precio": row[1],
                    "peso": row[2],
                    "nombre_lavanderia": config.get("nombre_lavanderia", "Lavandería Express"),
                }
                imprimir_ticket(ticket_data)
            else:
                print("✗ Cliente no encontrado en el historial.")

        elif opcion == "7":
            print("\n¡Hasta luego! Gracias por usar Lavandería Express.")
            sys.exit(0)

        else:
            print("✗ Opción inválida. Intente de nuevo.")


if __name__ == "__main__":
    print(
        """
    ╔══════════════════════════════════════════════════════════════╗
    ║  LAVANDERÍA EXPRESS - SISTEMA DE ATENCIÓN AL CLIENTE     ║
    ║  Gestión de clientes, ventas, informes y tickets          ║
    ╚═════════════════════════════════════════════════════════════╝
    """
    )

    # Inicializar base de datos y configuración
    init_db()
    config = cargar_config()

    # Si no hay configuración, la configuración por defecto ya fue insertada en init_db()
    menu_principal()