<?php
// === EPL425 Weather Dashboard – api.php ===
// Provides two services:
// 1) POST JSON {username, region, city, country} -> insert into `requests` with server time()
// 2) GET ?username=... -> return latest 5 requests for that username as JSON

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$DB_HOST = "dbserver.in.cs.ucy.ac.cy";
$DB_USER = "student";
$DB_PASS = "gtNgMF8pZyZq6l53";
$DB_NAME = "epl425";

function send_json($data, $status=200){
  http_response_code($status);
  header('Content-Type: application/json');
  echo json_encode($data);
  exit;
}

$conn = mysqli_connect($DB_HOST, $DB_USER, $DB_PASS);
if (!$conn) {
  send_json(["error"=>"Could not connect"], 500);
}
if (!mysqli_select_db($conn, $DB_NAME)) {
  send_json(["error"=>"DB open failed"], 500);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $raw = file_get_contents('php://input');
  if (!$raw) { send_json(["error"=>"Empty body"], 400); }
  $data = json_decode($raw, true);
  if (!$data || !isset($data['username']) || !isset($data['region']) || !isset($data['city']) || !isset($data['country'])) {
    send_json(["error"=>"Invalid JSON"], 400);
  }
  $username = mysqli_real_escape_string($conn, $data['username']);
  $region = mysqli_real_escape_string($conn, $data['region']);
  $city = mysqli_real_escape_string($conn, $data['city']);
  $country = mysqli_real_escape_string($conn, $data['country']);
  $ts = time();

  $sql = "INSERT INTO requests (username, timestamp, region, city, country) VALUES ('$username', $ts, '$region', '$city', '$country')";
  $ok = mysqli_query($conn, $sql);
  if ($ok) {
    http_response_code(201);
    header('Content-Type: application/json');
    echo json_encode(["status"=>"created"]);
  } else {
    send_json(["error"=>"Insert failed"], 500);
  }
  mysqli_close($conn);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if (!isset($_GET['username']) || !$_GET['username']) {
    send_json(["error"=>"username required"], 400);
  }
  $username = mysqli_real_escape_string($conn, $_GET['username']);
  $sql = "SELECT username, timestamp, region, city, country FROM requests WHERE username='$username' ORDER BY timestamp DESC LIMIT 5";
  $res = mysqli_query($conn, $sql);
  if (!$res) { send_json(["error"=>"Select failed"], 500); }
  $rows = [];
  while ($row = mysqli_fetch_assoc($res)) {
    $rows[] = $row;
  }
  send_json($rows, 200);
}

http_response_code(405);
echo "Method Not Allowed";
mysqli_close($conn);
